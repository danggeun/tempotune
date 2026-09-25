// TS/JS 소스에서 문자열 리터럴(따옴표·템플릿)의 내용만 뽑는다. 주석과 정규식 리터럴은 건너뛴다.
// 완전한 파서가 아니라 이 저장소의 코드에 충분한 토크나이저 — 화면 문구가 코드에 박혀 있는지 검사하는 데 쓴다.
export function stringLiterals(src) {
  const out = []
  let i = 0, line = 1
  const tplDepth = [] // 템플릿 ${ } 안에서의 중괄호 깊이
  let prev = '' // 직전의 의미 있는 문자 — '/' 가 나눗셈인지 정규식인지 가른다
  const push = (text, at) => out.push({ text, line: at })
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') { line++; i++; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; line += (src.slice(i, end).match(/\n/g) || []).length; i = end; continue }
    if (c === "'" || c === '"') {
      const at = line; let j = i + 1, s = ''
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2; continue } if (src[j] === '\n') break; s += src[j++] }
      push(s, at); i = j + 1; prev = 'a'; continue
    }
    if (c === '`' || (c === '}' && tplDepth.length && tplDepth[tplDepth.length - 1] === 0)) {
      if (c === '}') tplDepth.pop()
      const at = line; let j = i + 1, s = ''
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { s += src[j + 1]; j += 2; continue }
        if (src[j] === '$' && src[j + 1] === '{') { tplDepth.push(0); j += 2; break }
        if (src[j] === '\n') line++
        s += src[j++]
      }
      push(s, at)
      if (src[j] === '`') j++
      i = j; prev = 'a'; continue
    }
    if (c === '{' && tplDepth.length) tplDepth[tplDepth.length - 1]++
    if (c === '}' && tplDepth.length) tplDepth[tplDepth.length - 1]--
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) { // 정규식 리터럴
      let j = i + 1, cls = false
      while (j < src.length && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++ }
      i = j + 1; while (/[a-z]/.test(src[i] || '')) i++
      prev = 'a'; continue
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}
