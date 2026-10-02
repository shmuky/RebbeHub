# RebbeHub's models, and how good they are

> **Licence.** Model descriptions and benchmarks: CC BY-NC-ND 4.0. The
> models are not released; all rights reserved.
>
> This page, the [/models](https://rebbehub.org/models) page on the site and
> its data (`apps/web/app/lib/models.ts`) are under that licence, not the
> repository's AGPL-3.0.

RebbeHub reads scans and hears recordings with models of its own: a text
reader for Likkutei Sichos, a reader for the maftechos, a detector for the
Miram (bold) words, and a Whisper that hears the Rebbe's Yiddish. The
models are RebbeHub's own and are not released: only what each one does,
which one is in use, and its scores are published here, each on a test it
never learned from.

Whatever a model writes is machine output: it stays labelled on the site
until a person checks it, however good its score.

## Every model at a glance

| Model | What it does | State |
| --- | --- | --- |
| rebbehub-kraken-ls-v1 | Reads the text of Likkutei Sichos from the scans | **in use**, reading vols 15-25 now |
| rebbehub-kraken-v1 | Reads the maftechos (indexes) | in use, for the maftechos |
| rebbehub-facenet-v2 | Finds which words on a page are in Miram (bold) | **in use** |
| rebbehub-facenet-v1 | Finds which words on a page are in Miram (bold) | replaced |
| rebbehub-whisper-v3 | Hears the Rebbe's Yiddish and writes it down | **in use** |
| rebbehub-whisper-v2 | Hears the Rebbe's Yiddish and writes it down | superseded |
| rebbehub-whisper-v1 | Hears the Rebbe's Yiddish and writes it down | superseded |

## The Likkutei Sichos reader (OCR)

Reads each line of a scanned Likkutei Sichos page into text. The model in
use is **rebbehub-kraken-ls-v1**. The maftechos reader,
**rebbehub-kraken-v1**, reads the indexes only and is not scored here.

### The test

4,500 lines of Likkutei Sichos vol 39 that no model learned from. The
answer key is the typed text, corrected against the scan, with 35
line-edge dashes and ". . ." added that the typed text lacked and the
scan has.

- **Letters**: letters read right. **Words**: words read right.
  **Lines perfect**: whole lines read with no mistake at all.
- **Body** and **Notes**: the letter score in the main text and in the
  footnotes.
- **Hard**: mix-ups of the look-alike letters ב/כ, ת/ח, ז/ן/ו.

### Headline

| Model | Letters | Words | Lines perfect | State |
| --- | --- | --- | --- | --- |
| PP-OCRv6, as it came (where it started) | 96.45% | 86.39% | about 44% | history |
| An earlier candidate (the best before it) | 99.82% | 99.41% | 96.1% | superseded |
| **rebbehub-kraken-ls-v1** | **99.91%** | **99.68%** | **97.7%** | **in use** |
| + the word check after reading | 99.88%* | 99.60%* | 97.3%* | in use |
| A later candidate (its best) | 99.87% | 99.51% | 97.0% | not better, not used |

\* Scored on a stricter answer key (without the 35 added marks), so it is
not lower than the line above: on the same key the word check only fixes
lines. It fixed 15 of the 16 lines with a hard-letter mistake and broke
none.

### Every candidate on the 4,500 lines

| Model or candidate | Letters | Words | Lines perfect | Body | Notes | Mistakes | Hard | Dash dropped / added | Dots dropped / added |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| recover start | 99.65 | 98.38 | 88.9 | 99.70 | 99.33 | 699 | 74 | 15 / 10 | 15 / 2 |
| 00-0.9985 | 99.81 | 99.41 | 96.2 | 99.82 | 99.79 | 372 | 24 | 57 / 1 | 43 / 0 |
| 00-0.9986 | 99.83 | 99.37 | 96.0 | 99.85 | 99.73 | 338 | 19 | 41 / 6 | 26 / 1 |
| 00-0.9984 | 99.83 | 99.36 | 95.9 | 99.84 | 99.74 | 346 | 14 | 33 / 1 | 34 / 2 |
| 00-0.9986-v1 | 99.80 | 99.30 | 95.6 | 99.82 | 99.70 | 399 | 18 | 57 / 0 | 47 / 0 |
| 01-0.9986 | 99.82 | 99.36 | 95.8 | 99.85 | 99.65 | 366 | 20 | 55 / 1 | 27 / 2 |
| 01-0.9986-v1 | 99.83 | 99.40 | 96.0 | 99.85 | 99.68 | 347 | 17 | 49 / 0 | 33 / 0 |
| 01-0.9987 | 99.82 | 99.38 | 96.0 | 99.84 | 99.69 | 361 | 17 | 49 / 0 | 41 / 0 |
| 01-0.9987-v1 (the best before it) | 99.82 | 99.41 | 96.1 | 99.84 | 99.69 | 357 | 18 | 51 / 0 | 42 / 0 |
| **rebbehub-kraken-ls-v1** | **99.91** | **99.68** | **97.7** | **99.93** | **99.81** | **179** | 18 | 4 / 0 | 6 / 1 |

Without the 35 added marks rebbehub-kraken-ls-v1 still wins: 99.87%
letters and 97.0% lines perfect, against 99.84% and 96.3%. It halved the
mistakes (357 to 179), almost all of them marks: dropped dashes 51 to 4,
dropped dots 42 to 6. The hard letters did not move (18 to 18).

The later candidates, on the same 4,500 lines with a key of the typed text
plus 24 line-edge marks, against rebbehub-kraken-ls-v1 read the same way:

| Model or candidate | Letters | Words | Lines perfect | Body | Notes | Mistakes | Hard | Dash dropped / added | Dots dropped / added |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **rebbehub-kraken-ls-v1** | **99.90** | **99.63** | **97.5** | 99.91 | 99.80 | **206** | 20 | 4 / 1 | 0 / 10 |
| r3-00-0.9982-2347 | 99.83 | 99.38 | 95.8 | 99.84 | 99.74 | 348 | 59 | 38 / 0 | 10 / 3 |
| r3-00-0.9983-0003 | 99.83 | 99.35 | 95.8 | 99.85 | 99.74 | 337 | 41 | 37 / 0 | 6 / 5 |
| r3-00-0.9984-0019 | 99.87 | 99.51 | 97.0 | 99.88 | 99.81 | 258 | 22 | 21 / 0 | 10 / 2 |
| r3-00-0.9986-0035 | 99.83 | 99.43 | 96.5 | 99.83 | 99.83 | 338 | 18 | 39 / 1 | 11 / 1 |
| r3-01-0.9984-0050 | 99.83 | 99.47 | 96.5 | 99.84 | 99.79 | 339 | 21 | 51 / 0 | 11 / 1 |
| r3-01-0.9984-v1-0105 | 99.84 | 99.48 | 96.6 | 99.84 | 99.82 | 323 | 21 | 47 / 0 | 11 / 1 |
| r3-01-0.9984-v2-0137 | 99.84 | 99.48 | 96.6 | 99.84 | 99.81 | 327 | 21 | 44 / 0 | 11 / 1 |
| r3-01-0.9985-0120 | 99.84 | 99.49 | 96.8 | 99.85 | 99.81 | 318 | 23 | 42 / 0 | 11 / 2 |
| r3-final-ppm_best | 99.83 | 99.43 | 96.5 | 99.83 | 99.83 | 338 | 18 | 39 / 1 | 11 / 1 |

None beats it; the gap is almost all dropped line-opening dashes.

### 300 checked lines of vol 39

An earlier, smaller test: 300 lines of vol 39 whose answer key was checked
line by line against the scan. The differences between candidates here are
1 to 6 mistakes in 300 lines, within noise, which is why the 4,500 lines
decide.

| Model or candidate | Letters | Words | Lines perfect | Body | Notes | Mistakes |
| --- | --- | --- | --- | --- | --- | --- |
| PP-OCRv6, as it came | 96.48% | 86.07% | 44.3% | 96.41% | 96.95% | 459 |
| s2-00-0.9953 | 99.82% | 99.24% | 94.7% | 99.8% | 99.94% | 24 |
| s2-00-0.9982 | 99.9% | 99.64% | 97.7% | 99.89% | 100.0% | 13 |
| s2-00-0.9981 | 99.92% | 99.64% | 97.7% | 99.93% | 99.88% | 10 |
| s2-abort | 99.92% | 99.64% | 97.3% | 99.93% | 99.82% | 11 |
| s2-00-0.9986 | 99.95% | 99.68% | 98.0% | 99.94% | 100.0% | 7 |
| s2-00-0.9982-v1 | 99.95% | 99.72% | 98.0% | 99.94% | 100.0% | 7 |
| s2-00-0.9984 | 99.89% | 99.52% | 96.7% | 99.89% | 99.82% | 15 |
| s2-00-0.9980 | 99.9% | 99.56% | 97.0% | 99.92% | 99.77% | 13 |
| s2-01-0.9982 | 99.92% | 99.6% | 97.0% | 99.95% | 99.77% | 10 |
| s2-01-0.9979 | 99.92% | 99.52% | 97.3% | 99.92% | 99.88% | 11 |
| s2-00-0.9985 | 99.92% | 99.68% | 98.0% | 99.91% | 100.0% | 10 |

Mistakes by kind, and the most common confusions (∅ = nothing, a dropped
or extra mark; ␣ = space):

| Model or candidate | By kind | Top confusions |
| --- | --- | --- |
| PP-OCRv6, as it came | nikud 152, quote 101, letter 66, punct 55, digit 50, final 25, space 10 | ַ→∅ 61, „→" 59, ָ→∅ 48, ־→∅ 29, )→∅ 27, ,→. 11, ת→ח 10, ל→7 9 |
| s2-00-0.9953 | punct 7, space 5, letter 3, nikud 3, quote 2, final 2, digit 2 | ␣→∅ 5, .→∅ 4, י→∅ 2, ־→∅ 2, —→∅ 1, "→∅ 1, ן→∅ 1, ∅→. 1 |
| s2-00-0.9982 | punct 5, space 3, letter 3, quote 1, digit 1 | .→∅ 3, ␣→∅ 3, ∅→ו 1, ז→ן 1, )→∅ 1, ,→∅ 1, *→∅ 1, י→∅ 1 |
| s2-00-0.9981 | punct 4, space 3, letter 2, digit 1 | ␣→∅ 3, .→∅ 2, י→" 1, ב→כ 1, )→∅ 1, *→∅ 1, 5→∅ 1 |
| s2-abort | punct 4, letter 3, space 2, digit 2 | .→∅ 2, ␣→∅ 2, י→" 1, ת→ח 1, 2→∅ 1, )→∅ 1, *→∅ 1, י→∅ 1 |
| s2-00-0.9986 | space 3, punct 3, letter 1 | ␣→∅ 2, ∅→␣ 1, ∅→— 1, )→∅ 1, *→∅ 1, מ→∅ 1 |
| s2-00-0.9982-v1 | punct 3, space 2, letter 2 | ␣→∅ 1, ז→ן 1, ל→∅ 1, ∅→— 1, ∅→. 1, ∅→␣ 1, *→∅ 1 |
| s2-00-0.9984 | punct 4, space 4, letter 3, nikud 2, quote 1, digit 1 | ␣→∅ 4, ב→כ 3, .→∅ 2, —→∅ 1, ־→∅ 1, *→∅ 1, ∅→" 1, ּ→∅ 1 |
| s2-00-0.9980 | punct 4, space 4, letter 3, final 1, digit 1 | ␣→∅ 4, .→∅ 2, ן→ו 1, ב→כ 1, ת→ח 1, —→∅ 1, ז→ן 1, *→∅ 1 |
| s2-01-0.9982 | letter 4, punct 2, digit 2, nikud 1, space 1 | ב→כ 3, ∅→— 1, ־→ד 1, ז→ן 1, 2→∅ 1, *→∅ 1, ␣→∅ 1, 5→∅ 1 |
| s2-01-0.9979 | space 4, punct 4, letter 2, digit 1 | ␣→∅ 4, .→∅ 1, ∅→) 1, ז→ן 1, ר→ד 1, ∅→— 1, *→∅ 1, 5→∅ 1 |
| s2-00-0.9985 | punct 3, space 3, letter 2, nikud 1, digit 1 | ␣→∅ 3, .→∅ 2, י→" 1, ־→∅ 1, *→∅ 1, כ→∅ 1, 3→1 1 |

### Is it honest about how sure it is?

Candidate s2-01-0.9979 on the 300 checked lines, by how sure it was of
each letter:

| Letter confidence | Letters | Wrong | Real error rate | Model expects |
| --- | --- | --- | --- | --- |
| below 0.5 | 1 | 1 | 100% | 75% |
| 0.5-0.95 | 37 | 0 | 0% | ~15% |
| 0.95-0.99 | 70 | 1 | 1.4% | 1.8% |
| 0.99-0.999 | 331 | 0 | 0% | 0.35% |
| 0.999 and up | 12,604 | 1 | 0.008% | 0.003% |

The letters it reads are honest. Most of its mistakes (13 of 16) are marks
it left out, and a left-out mark has no confidence, so checking the least
sure lines does not find them all.

### Weak spots

- **Yiddish.** Vols 15-17, the first it read (182 sichos, 725k words), are
  mostly Yiddish: 157 sichos against 25 Hebrew. There is no typed text of
  vols 15-29 to compare with, so these are the reader's own doubts, an
  estimate, not a measured score:

  | Text | Words | Confidence below 0.9 | Below 0.6 |
  | --- | --- | --- | --- |
  | Hebrew sichos, body | 43,178 | 1.24% | 0.33% |
  | Yiddish sichos, body | 402,534 | 2.81% | 0.64% |
  | Hebrew sichos, notes | 7,548 | 2.04% | 0.46% |
  | Yiddish sichos, notes (mostly Hebrew) | 189,563 | 1.85% | 0.49% |

  It is about twice as unsure on Yiddish body text as on Hebrew. That is
  the biggest gap.
- **Look-alike letters**: ב/כ, ת/ח, ז/ן (about 18 in the 4,500 lines; the
  word check fixes most).
- **פ and ט read as ס** in the small note type (פירוש as סירוש, הבעש"ט as
  הבעש"ס).
- The point under a Yiddish alef is dropped now and then.
- **Bare stars "\*"** are not read by the reader; they are taken from the
  ink.

Next: a round for Yiddish, scored again the same way to see the gap close.

## The Miram (bold) detector

In the Rebbe's sichos, Miram type marks the stressed words; RebbeHub shows
them as bold. The detector says, word by word, which words on a page are in
Miram.

The test: five regular sicha pages (38:40, 34:42, 31:93, 36:50, 33:70),
1,832 words, 82 of them in Miram, each word checked by eye.

| Model | Words agreeing with the eye | State |
| --- | --- | --- |
| Thickness rules, no model | partial words; misses whole Miram notes | replaced |
| rebbehub-facenet-v1 | 1,832 / 1,832 | replaced |
| **rebbehub-facenet-v2** | **1,832 / 1,832** | **in use** |

The first review round (2026-10-02) found 12 Miram misses, all on pages
built before rebbehub-facenet-v2 ran. Five pages is a small test; every
page checked in the review tool adds to it.

## The Rebbe's voice to text (Whisper)

Hears a recording of the Rebbe's Yiddish and writes it down, each word
timed. How a recording is transcribed is in
[transcription.md](transcription.md).

Scores are words wrong / letters wrong (WER / CER), lower is better, on
farbrengens no version learned from, in the booklets' spelling:

| Held out | ivrit.ai Yiddish (where it started) | v1 | v2 | **v3 (in use)** |
| --- | --- | --- | --- | --- |
| Three farbrengens of 5742, 395 clips | | | 11.8% / 5.7% | **10.1% / 5.2%** |
| 17 Tammuz 5742, 109 clips | | | 10.8% / 4.6% | **8.2% / 3.8%** |
| 11 Nissan 5733 (an older era), 344 clips | | | 13.7% / 5.2% | **13.7% / 5.1%** |
| 17 Tammuz 5742, the whole 29 minutes | 58% / 28% | 13.0% / 5.9% | 11.9% / 5.3% | **11.5% / 5.5%** |

As each version was scored when it was new (v3's 5742 score is in the
booklets' spelling and the earlier ones were not, so the table above is
the one to compare by):

| Model | 5742 farbrengens | 11 Nissan 5733 | Whole 17 Tammuz 5742 (29 min) | State |
| --- | --- | --- | --- | --- |
| ivrit.ai Yiddish (where it started) | about 60% | | | history |
| rebbehub-whisper-v1 | 12% / 6% | 22.5% / 9.0% | 13.0% / 5.9% | superseded |
| rebbehub-whisper-v2 | 9.5% / 4.8% | 13.8% / 5.2% | 11.9% / 5.3% | superseded |
| **rebbehub-whisper-v3** | 10.1% / 5.2% | 13.7% / - | **11.5% / 5.5%** | **in use** |

Weak spots: rarer words (`תנות` for `תענית`), and the older years
(11 Nissan 5733 above).

Next: a v4, scored on the same held-out farbrengens and used only if it
scores better.
