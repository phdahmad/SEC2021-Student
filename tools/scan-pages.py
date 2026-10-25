"""Page images for one batch, made on the teacher's computer from the scan PDF.

    python tools/scan-pages.py --batch MID --per-sheet 5 --stride 6 --extra 2 [--data <dir>]
    python tools/scan-pages.py --batch Q1  --per-sheet 2

Reads   batches/<ID>/source/*.pdf   (exactly one PDF)
        batches/<ID>/<ID>.draft.json (each student's position in the scan: "scan")
Writes  batches/<ID>/web/<university ID>_p<n>.webp  (width 1400, WebP quality 62)

Layout of the scan: sheet k (1-based) starts at page (k-1)*stride + 1 and has per-sheet pages.
Pages between sheets (stride > per-sheet) and the last --extra pages (signature sheet, blank)
are not used. Every used page must carry ink, and every skipped page between sheets must be
blank; otherwise nothing is written (use --force only after looking at the pages yourself).
Images come straight from the scanner's image in the PDF (pdfimages), colour kept when the
scan is in colour. Prints sheet numbers and masked IDs only.
"""
import argparse, glob, json, os, shutil, subprocess, sys, tempfile
from PIL import Image

WIDTH, QUALITY = 1400, 62
BLANK, INKED = 0.004, 0.01   # share of dark pixels: below BLANK = blank page, above INKED = written page

ap = argparse.ArgumentParser()
ap.add_argument('--batch', required=True)
ap.add_argument('--data')
ap.add_argument('--per-sheet', type=int, required=True)
ap.add_argument('--stride', type=int)
ap.add_argument('--extra', type=int, default=0)
ap.add_argument('--force', action='store_true')
a = ap.parse_args()
stride = a.stride or a.per_sheet

def fail(msg):
    print('Error:', msg, file=sys.stderr); sys.exit(1)

def data_dir():
    if a.data: return os.path.abspath(a.data)
    if os.environ.get('SEC2021_DATA'): return os.environ['SEC2021_DATA']
    cfg = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'local.config.json')
    if os.path.exists(cfg):
        c = json.load(open(cfg, encoding='utf-8'))
        for k in ('dataDir', 'dataDirLinux'):
            if c.get(k) and os.path.isdir(c[k]): return c[k]
    fail('Data folder not found (give --data or set local.config.json).')

DATA = data_dir()
bdir = os.path.join(DATA, 'batches', a.batch)
pdfs = glob.glob(os.path.join(bdir, 'source', '*.pdf'))
if len(pdfs) != 1: fail(f'expected exactly one PDF in {bdir}/source, found {len(pdfs)}')
pdf = pdfs[0]
draft_path = os.path.join(bdir, f'{a.batch}.draft.json')
if not os.path.exists(draft_path): fail(f'missing {draft_path} — import the batch first')
draft = json.load(open(draft_path, encoding='utf-8'))
mask = lambda i: '…' + str(i)[-3:]

info = subprocess.run(['pdfinfo', pdf], capture_output=True, text=True, check=True).stdout
pages = int(next(l.split()[-1] for l in info.splitlines() if l.startswith('Pages:')))
by_pos = {d['scan']: d for d in draft if d.get('scan')}
sheets = len(by_pos)
if sorted(by_pos) != list(range(1, sheets + 1)): fail(f'scan positions are not 1..{sheets}: {sorted(by_pos)}')
expected = sheets * stride + a.extra
if pages != expected:
    fail(f'{pages} pages in the PDF, expected {sheets} sheets × {stride} + {a.extra} = {expected}')

tmp = tempfile.mkdtemp(prefix='scan-')
try:
    subprocess.run(['pdfimages', '-j', '-jp2', '-png', pdf, os.path.join(tmp, 'img')], check=True)
    lst = subprocess.run(['pdfimages', '-list', pdf], capture_output=True, text=True, check=True).stdout.splitlines()[2:]
    per_page = {}
    files = sorted(glob.glob(os.path.join(tmp, 'img-*')))
    for row, f in zip(lst, files):
        p = int(row.split()[0]); per_page.setdefault(p, []).append(f)
    if sorted(per_page) != list(range(1, pages + 1)) or any(len(v) != 1 for v in per_page.values()):
        fail('each page must hold exactly one scanned image')

    def load(p):
        im = Image.open(per_page[p][0])
        im.load()
        if im.mode in ('1', 'L', 'LA', 'I;16', 'P') and not (im.mode == 'P' and 'transparency' in im.info):
            im = im.convert('L')
        else:
            im = im.convert('RGB')
        if im.width != WIDTH:
            im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        g = im.convert('L')
        hist = g.histogram()
        ink = sum(hist[:128]) / (g.width * g.height)
        return im, ink

    used, problems, out = {}, [], []
    for pos in range(1, sheets + 1):
        start = (pos - 1) * stride + 1
        for k in range(a.per_sheet):
            used[start + k] = (pos, k + 1)
    for p in range(1, pages + 1):
        im, ink = load(p)
        if p in used:
            pos, n = used[p]
            if ink < INKED: problems.append(f'page {p} (sheet {pos}, page {n}) looks blank ({ink:.4f})')
            out.append((by_pos[pos]['id'], n, im))
        elif p <= sheets * stride:
            if ink > BLANK: problems.append(f'page {p} between sheets is not blank ({ink:.4f})')
    if problems and not a.force:
        fail('\n  ' + '\n  '.join(problems) + '\nNothing written. Look at these pages; use --force if the layout is right.')
    web = os.path.join(bdir, 'web'); os.makedirs(web, exist_ok=True)
    for sid, n, im in out:
        im.save(os.path.join(web, f'{sid}_p{n}.webp'), 'WEBP', quality=QUALITY, method=6)
    mode = 'colour' if any(im.mode == 'RGB' for _, _, im in out) else 'grey'
    print(f'{a.batch}: {len(out)} page images ({sheets} sheets × {a.per_sheet}, {mode}) from {pages} scanned pages.')
    for pos in range(1, sheets + 1):
        d = by_pos[pos]; s = (pos - 1) * stride + 1
        print(f'  sheet {pos:>2} pages {s}–{s + a.per_sheet - 1} → {mask(d["id"])} (serial {d["serial"]})')
    for w in problems: print('  warning:', w)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
