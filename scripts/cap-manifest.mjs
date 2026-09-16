#!/usr/bin/env node
// Android 매니페스트 보정 — `npx cap add android` 가 만든 매니페스트에 마이크 권한이 없으면 넣고,
// 세로 고정·버전·백업 설정을 맞춘다.
// 왜: android/ 는 생성물이라 리포에 없고, RECORD_AUDIO 가 없으면 WebView getUserMedia 가 NotAllowedError 로 실패한다
//     (그런데 앱 설정에는 마이크 권한 항목이 아예 안 보인다 — 사용자가 고칠 수 없는 오류). cap:sync 가 매번 실행한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 안드로이드 자동 백업을 끈다 (R1). 기본값 true 면 녹음(IndexedDB)이 사용자가 모르는 사이
 * 구글 드라이브로 올라간다 — 연습 녹음은 개인 자료라 동의 없이 나가면 안 된다.
 * 대가: 새 폰으로 바꿀 때 기기 간 전송으로도 녹음이 넘어가지 않는다(다운로드·공유로 옮긴다). 멱등. 순수.
 */
export function setAllowBackup(xml) {
  if (/android:allowBackup="false"/.test(xml)) return xml
  if (/android:allowBackup="true"/.test(xml)) return xml.replace(/android:allowBackup="true"/, 'android:allowBackup="false"')
  return xml.replace(/<application(\s)/, '<application android:allowBackup="false"$1')
}

/**
 * dist 가 GitHub Pages 용 빌드(base=/<레포명>/)인지 (R3). 그대로 APK 에 넣으면 자산 경로가 어긋나 **흰 화면**이 된다.
 * 앱 빌드는 `npm run build:cap`(BASE=/) 이라 자산이 `/assets/` 에 있고, Pages 빌드는 `/<무언가>/assets/` 에 있다.
 * 레포명을 박지 않는다 — 이름이 바뀌어도 가드가 계속 작동해야 한다. 순수.
 */
export function isWebBuildHtml(html) { return /(?:src|href)="\/[^"/]+\/assets\//.test(html) }

export function main(log = console.log) {
  // R3: 잘못된 dist 가 동기화된 채로 APK 를 만들지 않게 먼저 막는다
  const distHtml = join(ROOT, 'dist', 'index.html')
  if (existsSync(distHtml) && isWebBuildHtml(readFileSync(distHtml, 'utf8'))) {
    console.error('\x1b[31mdist/ 가 웹(GitHub Pages)용 빌드입니다 — 이대로 APK 를 만들면 흰 화면이 됩니다.\x1b[0m')
    console.error('`npm run build` 결과입니다. 앱은 `npm run cap:sync` 를 쓰세요 (BASE=/ 로 다시 빌드합니다).')
    process.exit(1)
  }

  const path = join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
  if (!existsSync(path)) { log('android/ 없음 — `npx cap add android` 후 다시 실행'); return }
  let xml = readFileSync(path, 'utf8'), changed = false
  const NEEDED = ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.INTERNET']
  for (const perm of NEEDED) {
    if (!xml.includes(`"${perm}"`)) { xml = xml.replace('</manifest>', `    <uses-permission android:name="${perm}" />\n</manifest>`); changed = true; log('추가: ' + perm) }
  }
  // 마이크는 있어도 되고 없어도 되는 기기 허용
  if (!xml.includes('android.hardware.microphone')) { xml = xml.replace('</manifest>', '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n</manifest>'); changed = true }
  // R1: 녹음이 클라우드로 새어 나가지 않게 자동 백업을 끈다
  const xb = setAllowBackup(xml)
  if (xb !== xml) { xml = xb; changed = true; log('allowBackup=false (자동 백업 끔)') }
  if (changed) { writeFileSync(path, xml); log('AndroidManifest.xml 갱신') } else log('AndroidManifest.xml 권한 OK')

  // 세로 고정 — CSS 오버레이("세로로 돌려주세요")에 더해 회전 자체를 막는다 (튜너를 보다가 폰이 기울어도 화면이 뒤집히지 않게)
  if (!xml.includes('android:screenOrientation')) {
    const x2 = xml.replace(/<activity(\s[^>]*?)android:name="\.MainActivity"/, (m, pre) => `<activity${pre}android:screenOrientation="portrait" android:name=".MainActivity"`)
    if (x2 !== xml) { xml = x2; writeFileSync(path, xml); log('AndroidManifest.xml: screenOrientation=portrait') }
  }

  // 버전 동기화 — android/ 는 생성물이라 build.gradle 의 versionName/versionCode 가 매번 1.0/1 로 돌아온다 → package.json 의 version 을 따른다
  const gradle = join(ROOT, 'android', 'app', 'build.gradle')
  if (existsSync(gradle)) {
    const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    const [a, b, c] = version.split('.').map(Number)
    const code = a * 10000 + b * 100 + c // 2.0.0 → 20000. 업데이트 설치가 되려면 항상 커져야 한다 (package.json 의 version 만 올리면 된다)
    const g = readFileSync(gradle, 'utf8')
    const g2 = g.replace(/versionCode\s+\d+/, `versionCode ${code}`).replace(/versionName\s+"[^"]*"/, `versionName "${version}"`)
    if (g2 !== g) { writeFileSync(gradle, g2); log(`build.gradle: versionName ${version}, versionCode ${code}`) } else log(`build.gradle 버전 OK (${version})`)
  }
}

// 직접 실행일 때만 (테스트가 import 할 때는 아니다). pathToFileURL: Windows 는 argv[1] 이 `C:\...` 라 `file://` 접두만으로는 절대 같지 않다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
