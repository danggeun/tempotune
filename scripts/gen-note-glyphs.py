#!/usr/bin/env python3
"""음표 아이콘(헤더 ♩, 리듬 버튼 다섯, 6/8 깃발)을 만들어 index.html·style.css 에 써 넣는다.
음표머리·깃발·점·3 은 Bravura(SMuFL, SIL OFL 1.1, © Steinberg Media Technologies) 글리프 윤곽,
줄기·보의 위치와 굵기는 SMuFL 조판 기본값(engravingDefaults, stemUpSE 앵커)으로 조립한다.
사용: npm pack @vexflow-fonts/bravura && tar xzf vexflow-fonts-bravura-*.tgz
      pip install fonttools && python3 scripts/gen-note-glyphs.py package   (저장소 루트에서)
"""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
PKG = sys.argv[1]
font = TTFont(f'{PKG}/bravura.otf'); gs = font.getGlyphSet(); cmap = font.getBestCmap()
meta = json.load(open(f'{PKG}/metadata.json'))
ED = meta['engravingDefaults']; AN = meta['glyphsWithAnchors']
U = 10            # 1 staff space = 10 viewBox units
UPM_SP = 250      # 1 staff space = 250 font units
def glyph(cp, x, y, scale=1.0):
    """코드포인트 cp 글리프를 staff-space 좌표 (x, y↑) 에 놓은 path d. 반환 좌표는 y↑ 그대로(나중에 뒤집는다)"""
    name = cmap[cp]; pen = RecordingPen()
    k = scale / UPM_SP
    gs[name].draw(TransformPen(pen, (k, 0, 0, k, x, y)))
    return pen.value  # [(op, ((x, y), ...)), ...] staff-space, y 위로
class Icon:
    def __init__(self): self.parts = []; self.rects = []
    def path(self, d): self.parts.append(d)
    def rect(self, x0, y0, x1, y1): self.rects.append((x0, y0, x1, y1))
def fmt(v): return f'{v:.2f}'.rstrip('0').rstrip('.')
def flip_path(rec, top, left):
    OPS = {'moveTo': 'M', 'lineTo': 'L', 'curveTo': 'C', 'qCurveTo': 'Q', 'closePath': 'Z', 'endPath': ''}
    out = []
    for op, pts in rec:
        out.append(OPS[op] + ' '.join(f'{fmt((px - left) * U)} {fmt((top - py) * U)}' for px, py in pts))
    return ''.join(out)
def pts_of(rec): return [p for _, ps in rec for p in ps]
def svg(icon, cls, extra_cls_parts=None, pad=0.12):
    xs, ys = [], []
    # bbox: 글리프는 대략값 대신 윤곽 좌표로
    for d in icon.parts:  # 따로 붙는 조각(깃발)은 상자에 넣지 않는다 — 숨겨져 있을 때도 음표가 가운데
        for px, py in pts_of(d): xs.append(px); ys.append(py)
    for x0, y0, x1, y1 in icon.rects: xs += [x0, x1]; ys += [y0, y1]
    left, right, bottom, top = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
    w, h = (right - left) * U, (top - bottom) * U
    body = ''.join(f'<path d="{flip_path(d, top, left)}"/>' for d in icon.parts)
    body += ''.join(f'<rect x="{fmt((x0-left)*U)}" y="{fmt((top-y1)*U)}" width="{fmt((x1-x0)*U)}" height="{fmt((y1-y0)*U)}"/>' for x0, y0, x1, y1 in icon.rects)
    body += ''.join(f'<path class="{c}" d="{flip_path(d, top, left)}"/>' for d, c in (extra_cls_parts or []))
    return f'<svg class="{cls}" viewBox="0 0 {fmt(w)} {fmt(h)}" aria-hidden="true">{body}</svg>', w, h, top, bottom

HEAD = 0xE0A4; FLAG8 = 0xE240; DOT = 0xE1E7; T3 = 0xE883
ST = ED['stemThickness']; BT = ED['beamThickness']; BS = ED['beamSpacing']
SE = AN['noteheadBlack']['stemUpSE']  # [1.18, 0.168]
STEM = 2.75   # 음표 중심에서 줄기 끝까지. SMuFL 글자용 짧은 줄기(textBlackNoteShortStem)와 같은 2.75 sp
ST = 0.16     # 줄기 굵기. 조판 기본 0.12 는 17 px 아이콘에서 흐려 조금 굵게
def note(icon, x, stem_top):
    icon.path(glyph(HEAD, x, 0))
    icon.rect(x + SE[0] - ST, SE[1], x + SE[0], stem_top)
    return (x + SE[0] - ST, x + SE[0])   # 줄기 좌우
def beamed(n, gap, beams, partial=None, dots=()):
    ic = Icon(); stems = []
    for i in range(n):
        stems.append(note(ic, i * gap, STEM))
    for k in range(beams):
        y1 = STEM - k * (BT + BS); ic.rect(stems[0][0], y1 - BT, stems[-1][1], y1)
    if partial:  # (마지막 음에서 왼쪽으로 뻗는 짧은 보, 길이 sp)
        y1 = STEM - (BT + BS); ic.rect(stems[-1][1] - partial, y1 - BT, stems[-1][1], y1)
    for x in dots: ic.path(glyph(DOT, x, 0))
    return ic, stems

out = {}
# ♩ (헤더·세분 1). 세분 1 은 6/8 에서 8분음표 깃발이 보인다
ic = Icon(); s = note(ic, 0, STEM)
out['quarter'] = svg(ic, 'note-glyph')
ic = Icon(); s = note(ic, 0, STEM)
fa = AN['flag8thUp']['stemUpNW']
flag = glyph(FLAG8, s[0] - fa[0], STEM - fa[1])
out['quarter_flag'] = svg(ic, 'note-glyph', [(flag, 'flag')])
# 8분 둘
ic, _ = beamed(2, 2.0, 1); out['g2'] = svg(ic, 'note-glyph g2')
# 셋잇단: 8분 셋 + 3
ic, st = beamed(3, 1.9, 1)
mid = (st[0][0] + st[-1][1]) / 2; tb = meta['glyphBBoxes']['tuplet3']; sc = 0.7
tw = (tb['bBoxNE'][0] - tb['bBoxSW'][0]) * sc
ic.path(glyph(T3, mid - tw / 2 - tb['bBoxSW'][0] * sc, STEM + 0.35, sc))
out['g3'] = svg(ic, 'note-glyph g3')
# 16분 넷
ic, _ = beamed(4, 1.75, 2); out['g4'] = svg(ic, 'note-glyph g4')
# 붓점: 점8분 + 16분 (둘째 보는 16분 쪽에 한 음표머리 길이)
ic, st = beamed(2, 2.5, 1, partial=1.0, dots=(1.18 + 0.22,))
out['gd'] = svg(ic, 'note-glyph gd')
d = {k: {'svg': v[0], 'w': v[1], 'h': v[2]} for k, v in out.items()}

import re
HTML, CSS = 'www/index.html', 'www/src/style.css'
s = open(HTML).read()
def repl_svg(s, anchor_re, new):
    m = re.search(anchor_re, s, re.S); assert m, anchor_re
    i = s.index('<svg', m.start()); j = s.index('</svg>', i) + 6
    return s[:i] + new + s[j:]
s = repl_svg(s, r'<span id="metro-hdr-label">', d['quarter']['svg'])
s = repl_svg(s, r'data-sd="1"', d['quarter_flag']['svg'])
s = repl_svg(s, r'data-sd="2"', d['g2']['svg'])
s = repl_svg(s, r'data-sd="3"', d['g3']['svg'])
s = repl_svg(s, r'data-sd="4"', d['g4']['svg'])
s = repl_svg(s, r'data-sd="d"', d['gd']['svg'])
open(HTML, 'w').write(s)
H = d['quarter']['h']; px = 17 / H; hpx = 20 / H
w = lambda k: round(d[k]['w'] * px, 1)
h3 = round(d['g3']['h'] * px, 1); lift = round((d['g3']['h'] - H) * px, 1)
c = open(CSS).read()
c = re.sub(r"\.note-glyph\{width:[^}]*\}", f".note-glyph{{width:{w('quarter')}px;height:17px;fill:currentColor;display:inline-block;vertical-align:-3px;overflow:visible;}}", c, 1)
c = re.sub(r"\.note-glyph\.g2\{[^\n]*", f".note-glyph.g2{{width:{w('g2')}px;}}.note-glyph.g4{{width:{w('g4')}px;}}.note-glyph.gd{{width:{w('gd')}px;}}.note-glyph.g3{{width:{w('g3')}px;height:{h3}px;margin-top:-{lift}px;}} /* 셋잇단은 위에 3 이 올라간다 — 올라간 만큼 끌어올려 음표머리 줄을 다른 버튼과 맞춘다 */", c, 1)
c = re.sub(r"#metro-hdr-label \.note-glyph\{[^}]*\}", f"#metro-hdr-label .note-glyph{{width:{round(d['quarter']['w']*hpx,1)}px;height:20px;vertical-align:0;}}", c, 1)
open(CSS, 'w').write(c)
print('widths', w('quarter'), w('g2'), w('g3'), w('g4'), w('gd'), 'g3', h3, lift)
