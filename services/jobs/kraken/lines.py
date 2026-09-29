"""
Kraken on this machine's CPU, for `rebbehub ocr --engine kraken-index`
(services/jobs/src/ocr.ts, `kraken`). Reads the two-column Hebrew subject
indexes (מפתח ענינים) of Likkutei Sichos with RebbeHub's own Kraken model
(rebbehub-kraken-v<N>, kept private in R2), which on a volume it never
trained on read 610 of 615 page references right, against Tesseract's 593.

    python3 lines.py --model <model.safetensors> [--tessdata <folder>] <page.png>...

Prints one JSON line per page image: the page's lines, [{"id", "text",
"box": [left, top, width, height]}], the box as fractions of the image, in
the shape linesFromTsv gives for Tesseract. Lines are in the order the
index is read: the right column before the left, each top to bottom.

Kraken reads lines but does not find them here: Tesseract finds them, as
in training, and Kraken reads each within a box drawn round all the ink of
the line's band. Where Kraken leaves out a volume letter or a bracket that
Tesseract's reading of the same line has, it is taken from there. Only
lines come out; parsing the index into topics and links is not RebbeHub's
work (shmuky/RebbeHub-OCR, experiments/maftechos, where this is from).

Needs `pip install kraken` (7.x) and Tesseract with its Hebrew and English
models. `--tessdata` points at other models, such as tessdata_best, which
the experiments used.
"""
import argparse, csv, io, json, math, os, re, subprocess, sys

import numpy as np
from PIL import Image

HEB_LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת'
PAD = 40
TESSDATA = None
# Tesseract is called many times on small crops; on one thread each call is
# far quicker (a page in half a minute instead of over two).
TESSERACT_ENV = {**os.environ, 'OMP_THREAD_LIMIT': '1'}


# ---------------------------------------------------------------- layout

def deskew(a):
    """Scans lean a little; turn the page so its lines are level (the angle whose rows are sharpest). Returns the page and the angle."""
    small = Image.fromarray(a).resize((a.shape[1] // 4, a.shape[0] // 4))
    best = (0, 0.0)
    for tenth in range(-20, 21, 2):
        r = np.array(small.rotate(tenth / 10, fillcolor=255)) < 128
        score = np.var(r.sum(1))
        if score > best[0]:
            best = (score, tenth / 10)
    if best[1] == 0:
        return a, 0.0
    return np.array(Image.fromarray(a).rotate(best[1], fillcolor=255, resample=Image.BICUBIC)), best[1]


def body_bounds(a):
    """Rows between the header rule and the footer rule (the Otzar HaChochma stamp), when the page has them."""
    ink = (a < 128).sum(1)
    h, w = a.shape
    rules = np.where(ink > w * 0.5)[0]
    top = max([r for r in rules if r < h * 0.15], default=0) + 20
    bottom = min([r for r in rules if r > h * 0.85], default=h) - 10
    return top, bottom


def split_columns(a, top, bottom):
    """Where to cut the page into its two columns; None when it is one column.
    The cut is in the middle of the widest empty band near the middle: the left
    column's volume letters stand in a narrow strip of their own beside the
    gutter, and cutting at the first empty spot gave them to the right column."""
    ink = (a[top:bottom] < 128).sum(0).astype(float)
    ink = np.convolve(ink, np.ones(7) / 7, mode='same')
    w = a.shape[1]
    lo, hi = int(w * 0.35), int(w * 0.65)
    empty = ink[lo:hi] <= 0.01 * (bottom - top)
    runs, start = [], None
    for i, e in enumerate(list(empty) + [False]):
        if e and start is None:
            start = i
        elif not e and start is not None:
            runs.append((start, i))
            start = None
    if not runs:
        return None
    s, e = max(runs, key=lambda r: r[1] - r[0])
    return lo + (s + e) // 2


# ---------------------------------------------------------------- Tesseract: finding lines

def tesseract(img, args):
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format='PNG')
    extra = ['--tessdata-dir', TESSDATA] if TESSDATA else []
    out = subprocess.run(['tesseract', 'stdin', 'stdout'] + extra + args, input=buf.getvalue(), capture_output=True, env=TESSERACT_ENV)
    return out.stdout.decode('utf-8')


def read_digits(img):
    """The page numbers in a crop, as text ("283 298"), read three ways (at the
    size scanned, at twice the size, and by the Hebrew model); the reading two
    agree on wins. A bold 75 reads as 718 at one size, and a first digit is lost
    at the other."""
    def eng(im):
        text = tesseract(im, ['-l', 'eng', '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789-(). '])
        return ' '.join(re.findall(r'\d[\d-]*\d|\d', text))
    padded = np.pad(img, 10, constant_values=255)
    big = np.array(Image.fromarray(padded).resize((padded.shape[1] * 2, padded.shape[0] * 2), Image.LANCZOS))
    heb = ' '.join(re.findall(r'\d[\d-]*\d|\d', tesseract(padded, ['-l', 'heb', '--psm', '7'])))
    reads = [eng(img), eng(big), heb]
    for r in reads[:2]:
        if r and reads.count(r) >= 2:
            return r
    return reads[0] or reads[1]


def column_lines(col):
    """A column's lines as Tesseract finds and reads them, top to bottom, in the
    column padded by PAD. Tesseract's Hebrew model drops digits of a number that
    starts a line, so ink no word covers is read again for digits (or a volume
    letter), and the line is rebuilt right to left."""
    col = np.pad(col, PAD, constant_values=255)
    tsv = tesseract(col, ['-l', 'heb', '--psm', '4', '-c', 'tessedit_create_tsv=1', '-c', 'tessedit_create_txt=0'])
    rows = list(csv.reader(io.StringIO(tsv), delimiter='\t', quoting=csv.QUOTE_NONE))[1:]
    lines = {}
    for r in rows:
        if len(r) < 12 or r[0] != '5' or not r[11].strip():
            continue
        key = (int(r[2]), int(r[3]), int(r[4]))
        x, y, w, h = map(int, r[6:10])
        lines.setdefault(key, []).append({'x': x, 'y': y, 'w': w, 'h': h, 'text': r[11]})
    out = []
    for words in lines.values():
        y0 = min(t['y'] for t in words)
        y1 = max(t['y'] + t['h'] for t in words)
        strip = col[y0:y1] < 128
        covered = np.zeros(col.shape[1], bool)
        for t in words:
            if re.fullmatch(r'[\d\-]+[.,]?', t['text']):
                continue  # numbers are read again below, with the ink beside them
            covered[max(0, t['x'] - 4): t['x'] + t['w'] + 4] = True
        xs = np.where((strip.sum(0) > 0) & ~covered)[0]
        spans = []
        for x in xs:
            if spans and x - spans[-1][1] <= 14:
                spans[-1][1] = x + 1
            else:
                spans.append([x, x + 1])
        spans = [(s, e) for s, e in spans if e - s >= 12]
        tokens = [t for t in words if not re.fullmatch(r'[\d\-]+[.,]?', t['text'])]
        for s, e in spans:
            crop = col[max(0, y0 - 4):y1 + 4, max(0, s - 6):e + 6]
            digits = read_digits(crop)
            if re.search(r'\d', digits):
                tokens.append({'x': s, 'w': e - s, 'text': digits})
            else:
                letter = tesseract(np.pad(crop, 20, constant_values=255), ['-l', 'heb', '--psm', '10']).strip()
                if re.fullmatch(f'[{HEB_LETTERS}]{{1,2}}', letter):
                    tokens.append({'x': s, 'w': e - s, 'text': letter})
                elif e - s <= 45 and s > max(t['x'] + t['w'] for t in words):
                    tokens.append({'x': s, 'w': e - s, 'text': '?'})
        tokens.sort(key=lambda t: -t['x'])  # right to left
        out.append({'y': y0, 'h': y1 - y0, 'x_left': min(t['x'] for t in words), 'x_right': max(t['x'] + t['w'] for t in words), 'text': ' '.join(t['text'] for t in tokens)})
    out.sort(key=lambda l: l['y'])
    # Pages without a header rule keep the running head: the page number and "מפתח ענינים / from-to".
    while out and out[0]['y'] < 200 and (re.fullmatch(r'\W*\d{1,4}\W*', out[0]['text']) or re.search(r'מפת[חת]|ענינים\s*/', out[0]['text'])):
        out.pop(0)
    return col, out


def ink_box(padded, l):
    """The line's box, round all the ink in its band: Tesseract's box sometimes
    leaves out a number at the line's start. Kept as tight as in training."""
    y0, y1 = max(0, l['y'] - 6), min(padded.shape[0], l['y'] + l['h'] + 6)
    xs = np.where((padded[l['y']:l['y'] + l['h']] < 128).sum(0) > 0)[0]
    x0 = min(l['x_left'], xs.min()) if len(xs) else l['x_left']
    x1 = max(l['x_right'], xs.max() + 1) if len(xs) else l['x_right']
    return (max(0, int(x0) - 10), int(y0), min(padded.shape[1], int(x1) + 10), int(y1))


# ---------------------------------------------------------------- Kraken: reading them

def with_volume_letter(kraken, tesseract):
    """The bold volume letter that opens a line in the multi-volume indexes
    stands apart from the text, and Kraken sometimes leaves it out. Tesseract's
    line keeps it; take it from there."""
    kraken = re.sub(r'^([א-ת]{1,2})(\d)', r'\1 \2', kraken.strip())
    m = re.match(r'\s*([א-ת]{1,2}|\?)\s+\d', tesseract)
    if m and re.match(r'\d', kraken):
        kraken = m.group(1) + ' ' + kraken
    return with_brackets(kraken, tesseract)


def with_brackets(kraken, tesseract):
    """A page inside a note that runs on ("[857]") is printed in square brackets,
    which Kraken reads as נ857), (1857, 8571) and the like, while Tesseract keeps
    the brackets (or at least the number). Where Tesseract has the number and
    Kraken shows one of those marks round it, bracket Kraken's digits."""
    near = lambda a, b: len(a) == len(b) and sum(x != y for x, y in zip(a, b)) <= 1
    bracketed = re.findall(r'\[(\d{1,4})\]', tesseract)
    plain = re.findall(r'(?<!\d)\d{1,4}(?!\d)', tesseract)
    mark = r'(?<!\d)(?P<open>נ|\(1|\[|1(?=\d{3}\)))?(?P<n>\d{2,4}?)(?P<close>1\)|\(\)|\]|\))'
    out, pos = [], 0
    for k in re.finditer(mark, kraken):
        n = k.group('n')
        odd = (k.group('open') or '') + k.group('close')
        is_bracket = any(near(n, t) for t in bracketed) or (odd not in (')',) and any(near(n, t) for t in plain) and not any(t == n + '1' for t in plain))
        if is_bracket and odd != ')' or (k.group('close') == ')' and k.group('open') and any(near(n, t) for t in bracketed)):
            fixed = '[' + n + ']'
            fixed = '(' + fixed + ')' if k.group('open') == '(1' else fixed + ')' if k.group('close') == '()' else fixed
            out.append(kraken[pos:k.start()] + fixed)
            pos = k.end()
    return ''.join(out) + kraken[pos:]


def load(model_path):
    from kraken.configs import RecognitionInferenceConfig
    from kraken.containers import BBoxLine, Segmentation
    from kraken.tasks import RecognitionTaskModel
    net = RecognitionTaskModel.load_model(model_path)
    config = RecognitionInferenceConfig(text_direction='horizontal-rl', num_line_workers=0)

    def read(padded, lines):
        boxes = [BBoxLine(id=str(i), bbox=ink_box(padded, l), text_direction='horizontal-rl') for i, l in enumerate(lines)]
        seg = Segmentation(type='bbox', imagename='page', text_direction='horizontal-rl', script_detection=False, lines=boxes)
        return [(box.bbox, rec.prediction.strip()) for box, rec in zip(boxes, net.predict(Image.fromarray(padded), seg, config))]
    return read


# ---------------------------------------------------------------- a page

def unturn(box, angle, w, h):
    """A box on the levelled page, back on the page as scanned: the page image
    the reader sees is not turned, so the box is turned back and bounded again."""
    if not angle:
        return box
    t = math.radians(angle)
    cx, cy = w / 2, h / 2
    x0, y0, x1, y1 = box
    xs, ys = [], []
    for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
        dx, dy = x - cx, y - cy
        xs.append(cx + dx * math.cos(t) - dy * math.sin(t))
        ys.append(cy + dx * math.sin(t) + dy * math.cos(t))
    return (max(0, min(xs)), max(0, min(ys)), min(w, max(xs)), min(h, max(ys)))


def page_lines(read, image):
    a = np.array(Image.open(image).convert('L'))
    h, w = a.shape
    a, angle = deskew(a)
    top, bottom = body_bounds(a)
    gutter = split_columns(a, top, bottom)
    # The right column first: the index is read right to left.
    columns = [(gutter, a[top:bottom, gutter:]), (0, a[top:bottom, :gutter])] if gutter else [(0, a[top:bottom])]
    round4 = lambda n: round(n, 4)
    out = []
    for x_at, col in columns:
        padded, lines = column_lines(col)
        if not lines:
            continue
        for l, (bbox, text) in zip(lines, read(padded, lines)):
            text = with_volume_letter(text, l['text'])
            if not text:
                continue
            x0, y0, x1, y1 = unturn((bbox[0] - PAD + x_at, bbox[1] - PAD + top, bbox[2] - PAD + x_at, bbox[3] - PAD + top), angle, w, h)
            out.append({'id': f'l{len(out) + 1}', 'text': text, 'box': [round4(x0 / w), round4(y0 / h), round4((x1 - x0) / w), round4((y1 - y0) / h)]})
    return out


def main():
    global TESSDATA
    p = argparse.ArgumentParser()
    p.add_argument('images', nargs='+')
    p.add_argument('--model', required=True)
    p.add_argument('--tessdata')
    a = p.parse_args()
    TESSDATA = a.tessdata
    read = load(a.model)
    for image in a.images:
        print(json.dumps(page_lines(read, image), ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
