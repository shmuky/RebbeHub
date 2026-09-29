# Transcribing the Rebbe's recordings

`rebbehub transcribe` and `rebbehub align` (services/jobs/src/transcribe.ts)
turn a recording into a machine transcript, each paragraph and word timed,
and sync the farbrengen's hanacha to it paragraph by paragraph. Which
Whisper hears the recording is the `--engine`:

- `local`: ivrit.ai's Yiddish Whisper
  ([yi-whisper-large-v3-turbo](https://huggingface.co/ivrit-ai/yi-whisper-large-v3-turbo),
  Apache-2.0) on the machine's own CPU, through faster-whisper
  (`pip install faster-whisper`; services/jobs/whisper/transcribe.py).
  Free. `WHISPER_MODEL` names another model.
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

## Next

1. Run the local engine over a year of farbrengens and sync their
   hanachos; everything stays labelled as machine output.
2. Fine-tune on the Rebbe's own voice: Sichos Kodesh's typed Yiddish
   hanachos, synced paragraph by paragraph as above, give hundreds of hours
   of the Rebbe's speech with near-verbatim text, Loshon Kodesh spelled
   right. That wants a rented GPU for a day or two; the paragraphs people
   correct on the site become better training data each round.
3. Score each model on a few recordings people transcribed word for word,
   rather than against the hanacha.
