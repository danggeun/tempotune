export function bufToWav(buf) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length
  const ab = new ArrayBuffer(44 + len * ch * 2); const dv = new DataView(ab)
  const s = (o, v) => { for (let i = 0; i < v.length; i++) dv.setUint8(o + i, v.charCodeAt(i)) }
  s(0, 'RIFF'); dv.setUint32(4, ab.byteLength - 8, true); s(8, 'WAVE')
  s(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true)
  dv.setUint16(22, ch, true); dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true)
  s(36, 'data'); dv.setUint32(40, len * ch * 2, true)
  let off = 44
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, buf.getChannelData(c)[i]))
    dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7FFF, true); off += 2
  }
  return ab
}
