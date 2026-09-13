/**
 * 녹음 컨테이너 판정. 순수 (테스트·워커 무관).
 *
 * 왜 필요한가 (B13): 확장자를 `MediaRecorder.mimeType` 문자열로만 정하면 내용과 어긋날 수 있다 —
 * 브라우저가 빈 문자열이나 예상 밖 값을 주는 경우가 있고, 그러면 아이폰에서 열 수도 보낼 수도 없는
 * 파일이 나온다. 파일 앞부분 바이트가 진실이다.
 *   MP4/M4A : 오프셋 4..8 = 'ftyp'
 *   WebM/MKV: 앞 4바이트 = 1A 45 DF A3 (EBML)
 */
export type RecContainer = 'm4a' | 'webm'

/** mime 문자열로 추정. 알 수 없으면 'm4a' — 아이폰·안드로이드·데스크톱이 모두 여는 쪽이 안전한 기본값이다. */
export function extFromMime(mime: string | undefined): RecContainer {
  if (!mime) return 'm4a'
  const m = mime.toLowerCase()
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  if (m.includes('webm') || m.includes('matroska')) return 'webm'
  return 'm4a'
}

/** 파일 앞 12바이트 이상으로 판정. 시그니처가 없으면 null (호출부가 mime 으로 폴백). */
export function sniffContainer(head: Uint8Array | ArrayBuffer): RecContainer | null {
  const b = head instanceof Uint8Array ? head : new Uint8Array(head)
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm'
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'm4a' // 'ftyp'
  return null
}

/** 내용 우선, 없으면 mime. 저장 시 한 번만 부르고 결과를 보관한다(재생·다운로드마다 blob 을 읽지 않게). */
export const containerOf = (head: Uint8Array | ArrayBuffer, mime?: string): RecContainer => sniffContainer(head) ?? extFromMime(mime)
