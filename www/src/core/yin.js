export function yin(buf, sr, threshold = 0.10) {
  const N = buf.length, half = Math.floor(N / 2)
  const d = new Float32Array(half)
  for (let tau = 1; tau < half; tau++) {
    let s = 0
    for (let j = 0; j < half; j++) { const dif = buf[j] - buf[j + tau]; s += dif * dif }
    d[tau] = s
  }
  const c = new Float32Array(half); c[0] = 1; let run = 0
  for (let tau = 1; tau < half; tau++) {
    run += d[tau]; c[tau] = run === 0 ? 0 : d[tau] / (run / tau)
  }
  let t = -1
  for (let tau = 2; tau < half - 1; tau++) {
    if (c[tau] < threshold) { while (tau + 1 < half && c[tau + 1] < c[tau]) tau++; t = tau; break }
  }
  if (t === -1) {
    let mn = Infinity
    for (let tau = 2; tau < half; tau++) { if (c[tau] < mn) { mn = c[tau]; t = tau } }
    if (t === -1 || mn > 0.5) return -1
  }
  const b = (t > 0 && t < half - 1) ? t + (c[t + 1] - c[t - 1]) / (2 * (2 * c[t] - c[t - 1] - c[t + 1])) : t
  return (b <= 0 || !isFinite(b)) ? -1 : sr / b
}
