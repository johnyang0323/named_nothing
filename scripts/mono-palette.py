"""One-off: rewrite every colour in src/style.css to black / white / purple
(with alpha), and every gradient to a plain colour. Kept for reference."""
import re, colorsys, sys

PURPLE = (139, 92, 246)

def parse(tok):
    tok = tok.strip()
    if tok.startswith('#'):
        h = tok[1:]
        if len(h) in (3, 4):
            h = ''.join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return r, g, b, a
    m = re.match(r'rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)', tok)
    if not m:
        return None
    a = m.group(4)
    a = 1.0 if a is None else (float(a[:-1]) / 100 if a.endswith('%') else float(a))
    return float(m.group(1)), float(m.group(2)), float(m.group(3)), a

def fmt(rgb, a):
    a = round(max(0.0, min(1.0, a)), 3)
    if a >= 0.999:
        return {(0, 0, 0): '#000', (255, 255, 255): '#fff', PURPLE: '#8b5cf6'}[rgb]
    return f'rgba({rgb[0]}, {rgb[1]}, {rgb[2]}, {a:g})'

def mono(tok):
    p = parse(tok)
    if not p:
        return tok
    r, g, b, a = p
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    if s > 0.35 and 0.68 <= h <= 0.80:          # violets → the purple
        return fmt(PURPLE, a)
    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    if lum >= 0.8:
        return fmt((255, 255, 255), a)
    if lum < 0.25:
        return fmt((0, 0, 0), a)
    return fmt((0, 0, 0), a * (1 - lum))

COLOR = re.compile(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)]*\)')

def strip_gradients(css):
    out, i = [], 0
    pat = re.compile(r'(?:repeating-)?(?:linear|radial|conic)-gradient\(')
    while True:
        m = pat.search(css, i)
        if not m:
            out.append(css[i:]); break
        out.append(css[i:m.start()])
        depth, j = 1, m.end()
        while depth:
            depth += {'(': 1, ')': -1}.get(css[j], 0); j += 1
        inner = css[m.end():j - 1]
        first = COLOR.search(inner)
        var = re.search(r'var\(--[\w-]+\)', inner)
        out.append(first.group(0) if first else (var.group(0) if var else 'transparent'))
        i = j
    return ''.join(out)

path = sys.argv[1]
css = open(path, encoding='utf-8').read()
css = strip_gradients(css)
# hex inside comments/selectors like #home are not colours; only touch values after ':' or ','
def fix_decl(m):
    return m.group(1) + COLOR.sub(lambda c: mono(c.group(0)), m.group(2))
css = re.sub(r'(:\s*)([^;{}]*)', fix_decl, css)
open(path, 'w', encoding='utf-8').write(css)
