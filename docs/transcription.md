# Transcribing the Rebbe's recordings

`rebbehub transcribe` and `rebbehub align` (services/jobs/src/transcribe.ts)
turn a recording into a machine transcript, each paragraph and word timed,
and sync the farbrengen's hanacha to it paragraph by paragraph. Which
Whisper hears the recording is the `--engine`:

- `local`: ivrit.ai's Yiddish Whisper
  ([yi-whisper-large-v3-turbo](https://huggingface.co/ivrit-ai/yi-whisper-large-v3-turbo),
  Apache-2.0) on the machine's own CPU, through faster-whisper
  (`pip install faster-whisper`; services/jobs/whisper/transcribe.py).
  Free. `WHISPER_MODEL` names another model: a Hugging Face id, or the
  folder of one on disk, such as rebbe-whisper (below), which the
  transcribe workflow fetches from R2 when it can.
- `workers-ai`: Whisper large-v3-turbo on Cloudflare Workers AI, paid by
  the minute (docs/deploy.md, step 7).

## Why the local engine

A test on 2026-09-29: the Tzom Gedaliah 5745 sicha (JEM's AR0021029, 44
minutes), against the typed Yiddish hanacha in Sichos Kodesh (the
הנחה בלתי מוגה, read with Tesseract's Yiddish model).

| First 6 minutes, 4 CPUs | Speed | Character error against the hanacha |
| --- | --- | --- |
| Whisper large-v3-turbo, Yiddish (as on Workers AI) | 3.9× speech | 65%, and much of it in Latin letters |
| ivrit.ai Hebrew Whisper turbo | 4.2× | 69% (Yiddish heard as Hebrew) |
| ivrit.ai Yiddish Whisper turbo | 4.5× | 66%, but nearly all of it Yiddish read right |

The hanacha is an edited write-up, not a verbatim record, so no model
scores well against it; the numbers compare the models, and reading the
output decides it. The Yiddish model gets the Yiddish words right. What
it gets wrong is the Loshon Kodesh, written as it sounds
(`דיבורי תירוש בקתב` for `דברי תורה שבכתב`, `שולחן אורך` for `שולחן ערוך`),
because it learned from modern Yiddish read aloud, not from sichos.

The whole 44 minutes took 13 minutes on 4 CPUs, and `alignParagraphs`
placed the hanacha's sections where they are said (section יד at 31:35,
where the Rebbe says `בזעקיך יצילוך קיבוציך`). So the timestamps are
usable now; the words need the steps below before people read them.

JEM's recordings open with "This audio has been restored by JEM". Whisper
then stays in English for its first half-minute and skips the Rebbe's
first words; the local engine hears that stretch again and drops the
English line.

## rebbe-whisper: fine-tuned on the Rebbe's voice

rebbe-whisper-5742 is the ivrit.ai Yiddish model trained further on 22.8
hours of the Rebbe's own speech: 17 farbrengens of 5742 whose word-for-word
Yiddish (הנחה מילולית, published by torasmoshiach.com) was cut into clips
by forced alignment. It trained for 4 epochs on one rented GPU for about
$2. Four more farbrengens of that year were held out to score it.

| Held out, against the word-for-word text | ivrit.ai Yiddish | rebbe-whisper-5742 |
| --- | --- | --- |
| 17 Tammuz 5742, the whole 29 minutes, as the job runs it | 58% words wrong, 28% letters | 10.8% words, 5.1% letters |
| 504 clips of the four farbrengens, 2.1 hours | 62%, 32% | 11.6%, 5.6% |

It spells the Loshon Kodesh right now (`דברי תורה שבכתב`, `שולחן ערוך`,
also on 5745 audio it never heard). What it still misses are rarer words
(`תנות` for `תענית`). It runs at the same speed, 3.5x speech on 4 CPUs.
Every test is from 5742; other years and poorer recordings are untested.

The model (1.6 GB) is not published. It is kept in
`rebbehub-preservation` at `models/rebbe-whisper-5742/`, and the workflow
fetches it with the R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY secrets.
Its transcripts, like any machine output, stay labelled until people
check them.

## Next

1. Run the local engine over a year of farbrengens and sync their
   hanachos; everything stays labelled as machine output.
2. Train the next round on more: other years' word-for-word texts, and the
   paragraphs people correct on the site. Keep the same held-out
   farbrengens and switch models only when the new one scores better.
