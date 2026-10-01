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

Whisper sometimes ends a piece in the middle of a word ("... פון דעם י",
then "וד, און ..."). The local engine marks a piece that carries on the
word before it (`glued`), and a paragraph never breaks there; a long
paragraph breaks at the end of a sentence where it can. Transcripts made
before that can have such a cut between two paragraphs; `rebbehub
mend-splits` joins the ones it is sure of, as one suggestion per recording,
in paragraphs no person has checked (`--dry-run` lists them first).

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

- **v3**: v2 trained further for 2 epochs on the same clips, with the 5742
  text first rewritten into the booklets' spelling. torasmoshiach writes some
  words as they sound (`אויכעט`, `דעמולט`, `בריינגט`); most booklets write
  them `אויך`, `דעמאלט`, `ברענגט`, so v2 had learned two spellings for one
  word. The booklets' spelling is now the house style for training text and
  for people correcting transcripts (packages/model/src/spelling.ts).

Scored in the booklets' spelling, words wrong / letters wrong:

| Held out | ivrit.ai Yiddish | v1 | v2 | v3 |
| --- | --- | --- | --- | --- |
| Three farbrengens of 5742, 395 clips | | | 11.8% / 5.7% | 10.1% / 5.2% |
| 17 Tammuz 5742, 109 clips | | | 10.8% / 4.6% | 8.2% / 3.8% |
| 11 Nissan 5733 (an older era), 344 clips | | | 13.7% / 5.2% | 13.7% / 5.1% |
| 17 Tammuz 5742, the whole 29 minutes, as the job runs it | 58% / 28% | 13.0% / 5.9% | 11.9% / 5.3% | 11.5% / 5.5% |

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
recordings with no transcript, `TRANSCRIBE_NIGHTLY` for each worker,
always with the local engine. The newest are taken whether RebbeHub
serves their file or they are heard at another site (Drive, JEM): none
of the catalog's recordings is a served file yet, so without that the
nightly run had nothing to do but requests (`TRANSCRIBE_LINKED=false`
keeps it to served files). A recording the nightly run failed on (its
link no longer plays, or nothing was heard) is left out of the sweep for
30 days, kept as the system's own failed request, so the sweep moves on;
asking for it again tries it at once. The OCR sweep does the same. A run can be split into workers side by
side (`TRANSCRIBE_WORKERS`, or **workers** when started by hand), each
taking its own part of the recordings. With `GITHUB_DISPATCH_TOKEN` set
on the API, a request starts the workflow at once for what was asked
([deploy](deploy.md#7-machine-ocr-and-transcription)). A rented GPU is
never started this way: each GPU run waits for a person.

## The retraining cycle

Every correction people make is training data for the next version,
gathered with nobody doing it by hand:

1. **People check.** On a farbrengen's transcript, **הכל מדוייק** marks a
   paragraph's words checked as they are; editing corrects them. Words a
   listener is not sure of are marked **לא ברור**, kept in the text as
   `[words?]` (`packages/model/src/unclear.ts`): the site shows them as
   uncertain, and a paragraph with one is left out of the clips. People
   check words only: the machine's timing is good enough, and the editor
   has no tools to move it. Under the
   editor the house spelling is shown (the booklets': אויך, דעמאלט,
   ברענגט, ע"י as written; `packages/model/src/spelling.ts`), with a hint
   for each word written otherwise, so everything checked is in one
   spelling. Every fix goes for review like any suggestion.
2. **The machine times the words again.** A corrected paragraph loses its
   word timings. The nightly run then runs `rebbehub align` on the
   recordings with corrected paragraphs first, timing the new words.
3. **They become clips.** `GET /v1/machine/training/clips` (or
   `rebbehub training-clips --out clips-site.jsonl`) gives every checked
   paragraph as clips in the training script's own format: `audio`,
   `start`, `end`, `text`, `split`, and `group: "site"`. Paragraphs over
   28 seconds are cut between words. A clip is `gold` when a person also
   set where it is heard, `silver` when that timing is the machine's.
   Each recording is wholly in `train` or wholly in `test`, by a hash of
   its id that never changes (one in ten is `test`), so a version is never
   scored on audio it learned from.
4. **When there is enough, train.** The goal for the next version is
   written in `TRAINING_GOAL` (core/trainingClips.ts): for V4, ten
   farbrengens checked through, about 34 hours, counted from the day V3
   was trained, never the held-out recordings. It is shown above every
   transcript to people signed in, with the farbrengens to check next
   (before 5740 first, where the model is weakest), in
   `GET /v1/machine/training` (its `goal`) and in the `training_data` MCP
   tool. Training still waits for Shmuly's OK
   for each paid GPU run; the clips go in with the booklets' and 5742's
   (`train.py --clips clips-5742.jsonl clips-booklets.jsonl
   clips-site.jsonl`), and the version is published to R2 only when it
   scores better on the same held-out farbrengens.
5. **The workflow picks it up.** The next transcription run uses the
   highest `models/rebbehub-whisper-v<N>/` in R2.

## Next

1. Run the local engine over a year of farbrengens and sync their
   hanachos; everything stays labelled as machine output.
2. Train the next version the way v2 was, adding the site's clips (the
   retraining cycle above). Keep the same held-out farbrengens and
   publish a version to R2 only when it scores better.
