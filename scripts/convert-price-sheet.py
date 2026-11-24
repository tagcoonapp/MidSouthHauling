"""Turns the 2022 Premier Hauling Base PDF text into one line per style code: 'CC 12x32 9695'."""
import re, subprocess, sys

pdf, out = sys.argv[1], sys.argv[2]
text = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
lines = text.splitlines()

# Column header rows name the style groups; each header's codes share the prices listed under it.
def codes(header):
    return [c for c in re.split(r"[,&\s]+", header.strip()) if c]

entry = re.compile(r"(\d{1,2})\*(\d{1,2})\s*\$\s*([\d,]+\.\d{2})")
rows = []
current = []  # list of (x_start, codes)
for ln in lines:
    if "Premier Buildings Hauling Base" in ln or not ln.strip():
        continue
    if not entry.search(ln):
        # header row: find groups of style names and their column positions
        groups = [(m.start(), codes(m.group(0))) for m in re.finditer(r"[A-Z]+(?:\s*[,&]\s*[A-Z]+)*", ln)]
        if groups:
            # a lone header (e.g. "GS, CS" under LG) replaces only the column it sits over
            if len(groups) < len(current) and current:
                for x, cs in groups:
                    idx = min(range(len(current)), key=lambda i: abs(current[i][0] - x))
                    current[idx] = (x, cs)
            else:
                current = groups
        continue
    entries = list(entry.finditer(ln))
    for m in entries:
        # Headers are centered over their columns, so an entry belongs to the last header starting before it (+10 chars).
        idx = max(0, sum(1 for x, _ in current if x <= m.start() + 10) - 1)
        w, l, price = m.group(1), m.group(2), m.group(3).replace(",", "")
        for code in current[idx][1]:
            rows.append((code, int(w), int(l), price))
    # A header can share a line with prices from other columns (e.g. "GS, CS" under LG).
    rest = entry.sub(lambda m: " " * len(m.group(0)), ln)
    for hm in re.finditer(r"[A-Z]+(?:\s*[,&]\s*[A-Z]+)*", rest):
        idx = min(range(len(current)), key=lambda i: abs(current[i][0] - hm.start()))
        current[idx] = (hm.start(), codes(hm.group(0)))

seen = set()
with open(out, "w") as f:
    f.write("# 2022 Premier Buildings Hauling Base (March 10, 2022). One line per style code: STYLE WxL PRICE\n")
    for code, w, l, price in rows:
        key = (code, w, l)
        if key in seen:
            raise SystemExit(f"duplicate {key}")
        seen.add(key)
        f.write(f"{code} {w}x{l} {price.rstrip('0').rstrip('.') if price.endswith('.00') else price}\n")
print(len(rows), "rows")
from collections import Counter
print(Counter(r[0] for r in rows))
