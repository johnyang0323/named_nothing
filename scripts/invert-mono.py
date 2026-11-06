"""One-off: swap black and white in src/style.css (keeping their opacity),
for the dark theme. Shadows keep their black, so depth still reads."""
import re, sys

path = sys.argv[1]
css = open(path, encoding='utf-8').read()
SKIP = re.compile(r'^\s*(box-shadow|text-shadow|filter|-webkit-filter)\s*$', re.I)

def swap(value):
    value = re.sub(r'rgba\(\s*0,\s*0,\s*0,', 'rgba(TMPW,', value)
    value = re.sub(r'rgba\(\s*255,\s*255,\s*255,', 'rgba(0, 0, 0,', value)
    value = value.replace('rgba(TMPW,', 'rgba(255, 255, 255,')
    value = re.sub(r'#000\b(?!0)|#000000\b', 'TMPHEXW', value)
    value = re.sub(r'#fff\b(?!f)|#ffffff\b', '#000', value, flags=re.I)
    return value.replace('TMPHEXW', '#fff')

def decl(m):
    prop, val = m.group(1), m.group(2)
    if SKIP.match(prop) or prop.strip().startswith('--glass-shadow') or prop.strip().startswith('--float-shadow') or prop.strip().startswith('--shadow'):
        return m.group(0)
    return f'{prop}:{swap(val)}'

css = re.sub(r'([-\w]+\s*):([^;{}]*)', decl, css)
open(path, 'w', encoding='utf-8').write(css)
