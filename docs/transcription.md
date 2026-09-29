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
  folder of one on disk, such as rebbehub-whisper (below), which the
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

## rebbehub-whisper: fine-tuned on the Rebbe's voice

Each version is ivrit.ai's Yiddish model trained further on the Rebbe's own
speech, clip by clip against a word-for-word Yiddish text, on one rented
GPU. None are published; they are kept in `rebbehub-preservation` under
`models/rebbehub-whisper-v<N>/` (the faster-whisper copy, and under `hf/`
the full weights the next version trains from), and the workflow picks the
highest version there.

- **v1**: 22.8 hours from 17 farbrengens of 5742, whose word-for-word text
  (הנחה מילולית) torasmoshiach.com publishes, lined up by forced alignment.
  3 epochs.
- **v2**: v1 trained further on those clips plus 43 hours from 23
  farbrengens of 5732 to 5747, from typed Yiddish booklets. The booklets
  don't say which recording a page belongs to and leave parts out, so v1
  heard each recording, the booklet's matching stretch was found by the
  words both share, and clips were cut between words they agree on. A clip
  was kept only where the booklet and what was heard are close, and its
  text is the booklet's.

| Held out, words wrong / letters wrong | ivrit.ai Yiddish | v1 | v2 |
| --- | --- | --- | --- |
| Four farbrengens of 5742, 504 clips | 62% / 32% | 12% / 6% | 9.5% / 4.8% |
| 11 Nissan 5733 (an older era), 344 clips | | 22.5% / 9.0% | 13.8% / 5.2% |
| 17 Tammuz 5742, the whole 29 minutes, as the job runs it | 58% / 28% | 10.8% / 5.1% (the first model) | |

They spell the Loshon Kodesh right (`דברי תורה שבכתב`, `שולחן ערוך`).
What they still miss are rarer words (`תנות` for `תענית`). They run at the
same speed as ivrit.ai's model, 3.5x speech on 4 CPUs. Their transcripts,
like any machine output, stay labelled until people check them. The
training scripts and the list of booklets are kept with the project's
files, not here, since the texts can't be.

## How a recording gets transcribed

Every night the *Machine transcription* workflow takes the recordings
people asked for (the button under a farbrengen's parts, the API, the
`ask_machine` MCP tool, `rebbehub machine ask`), then the newest
recordings with no transcript, `TRANSCRIBE_NIGHTLY` in all, always with
the local engine. With `GITHUB_DISPATCH_TOKEN` set on the API, a request
starts the workflow at once for what was asked ([deploy](deploy.md#7-machine-ocr-and-transcription)).
A rented GPU is never started this way: each GPU run waits for a person.

## Next

1. Run the local engine over a year of farbrengens and sync their
   hanachos; everything stays labelled as machine output.
2. Train the next version the way v2 was: the newest model hears the
   recordings, and the text comes from word-for-word booklets and the
   paragraphs people correct on the site. Keep the same held-out
   farbrengens and publish a version to R2 only when it scores better.
