#!/usr/bin/env node
// Android 매니페스트 권한 보정 — `npx cap add android` 가 만든 매니페스트에 마이크 권한이 없으면 넣는다.
// 왜: android/ 는 생성물이라 리포에 없고, RECORD_AUDIO 가 없으면 WebView getUserMedia 가 NotAllowedError 로 실패한다
//     (그런데 앱 설정에는 마이크 권한 항목이 아예 안 보인다 — 사용자가 고칠 수 없는 오류). cap:sync 가 매번 실행한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
if (!existsSync(path)) { console.log('android/ 없음 — `npx cap add android` 후 다시 실행'); process.exit(0) }
let xml = readFileSync(path, 'utf8'), changed = false
const NEEDED = ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.INTERNET']
for (const perm of NEEDED) {
  if (!xml.includes(`"${perm}"`)) { xml = xml.replace('</manifest>', `    <uses-permission android:name="${perm}" />\n</manifest>`); changed = true; console.log('추가:', perm) }
}
// 마이크는 있어도 되고 없어도 되는 기기 허용
if (!xml.includes('android.hardware.microphone')) { xml = xml.replace('</manifest>', '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n</manifest>'); changed = true }
if (changed) { writeFileSync(path, xml); console.log('AndroidManifest.xml 갱신') } else console.log('AndroidManifest.xml 권한 OK')

// 세로 고정 — CSS 오버레이("세로로 돌려주세요")에 더해 회전 자체를 막는다 (튜너를 보다가 폰이 기울어도 화면이 뒤집히지 않게)
if (!xml.includes('android:screenOrientation')) {
  const x2 = xml.replace(/<activity(\s[^>]*?)android:name="\.MainActivity"/, (m, pre) => `<activity${pre}android:screenOrientation="portrait" android:name=".MainActivity"`)
  if (x2 !== xml) { xml = x2; writeFileSync(path, xml); console.log('AndroidManifest.xml: screenOrientation=portrait') }
}

// 버전 동기화 — android/ 는 생성물이라 build.gradle 의 versionName/versionCode 가 매번 1.0/1 로 돌아온다 → package.json 의 version 을 따른다
const gradle = join(ROOT, 'android', 'app', 'build.gradle')
if (existsSync(gradle)) {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const [a, b, c] = version.split('.').map(Number)
  const code = a * 10000 + b * 100 + c // 2.0.0 → 20000. 업데이트 설치가 되려면 항상 커져야 한다 (package.json 의 version 만 올리면 된다)
  let g = readFileSync(gradle, 'utf8')
  const g2 = g.replace(/versionCode\s+\d+/, `versionCode ${code}`).replace(/versionName\s+"[^"]*"/, `versionName "${version}"`)
  if (g2 !== g) { writeFileSync(gradle, g2); console.log(`build.gradle: versionName ${version}, versionCode ${code}`) } else console.log(`build.gradle 버전 OK (${version})`)
}
