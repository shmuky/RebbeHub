"""
Whisper on this machine's own CPU (or GPU), for `rebbehub transcribe
--engine local` (services/jobs/src/transcribe.ts, localWhisper). Prints one
JSON line per piece heard: {"start", "end", "text", "words": [[word, start,
end], ...]}, times in seconds from the recording's start.

Whisper sometimes ends a piece in the middle of a word ("... פון דעם י",
then "וד, און ..."). Its own text tells a new word by the space before it,
which the stripped text loses, so a piece that carries on the last word of
the piece before is marked `"glued": true`, and so is a word that carries
on the word before it (a fourth item, `true`, after its times). Readers
that do not know the mark read the rest as before.

The default model is ivrit.ai's Yiddish Whisper, which on a test farbrengen
(Tzom Gedaliah 5745 against its typed hanacha) heard the Rebbe's Yiddish far
better than Whisper itself, which drifts into Latin letters and Hebrew
spelling. Needs `pip install faster-whisper`; the model is fetched once.

JEM's recordings open with a few seconds of English ("This audio has been
restored by JEM"). Whisper then keeps to English for its first half-minute
window and skips the Rebbe's first words, so when the recording opens in
Latin letters followed by a gap, the first minutes are heard again from
where the Rebbe starts.
"""
import argparse, json, re, sys

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from faster_whisper.vad import VadOptions, get_speech_timestamps

RATE = 16000


def heard(model, audio, language, offset=0.0):
    segments, _ = model.transcribe(audio, language=language, beam_size=5, word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
    for s in segments:
        text = s.text.strip()
        if text:
            words = []
            for w in s.words or []:
                if w.word.strip():
                    word = [w.word.strip(), round(offset + w.start, 3), round(offset + w.end, 3)]
                    if words and not w.word[:1].isspace():
                        word.append(True)
                    words.append(word)
            yield {
                'start': round(offset + s.start, 3),
                'end': round(offset + s.end, 3),
                'text': text,
                'words': words,
                # Whether Whisper put a space before it: read, and dropped, by glue() below.
                'spaced': s.text[:1].isspace(),
            }


def glue(out):
    """
    Marks the pieces that carry on the word the piece before ended in: no
    space before them, and the piece before ends in a letter, not in
    punctuation. A model that puts no space before most of its pieces is not
    telling words apart that way, so then nothing is marked.
    """
    loose = sum(1 for p in out if not p['spaced']) > len(out) / 2
    for i, p in enumerate(out):
        if not p.pop('spaced') and not loose and i > 0 and out[i - 1]['text'][-1:].isalpha():
            p['glued'] = True
            if p['words']:
                p['words'][0] = p['words'][0][:3] + [True]
    return out


def latin(text):
    letters = re.findall(r'[^\W\d_]', text)
    return bool(letters) and sum(1 for c in letters if c.isascii()) > len(letters) / 2


def main():
    p = argparse.ArgumentParser()
    p.add_argument('audio')
    p.add_argument('--language', default='yi')
    p.add_argument('--model', default='ivrit-ai/yi-whisper-large-v3-turbo-ct2')
    p.add_argument('--device', default='auto')
    p.add_argument('--compute-type', default='int8')
    a = p.parse_args()
    model = WhisperModel(a.model, device=a.device, compute_type=a.compute_type)
    audio = decode_audio(a.audio, sampling_rate=RATE)
    out = glue(list(heard(model, audio, a.language)))
    # An opening in English, then a long gap: from where the next speech starts, hear
    # the next minute and a half again without the English, and keep that instead.
    lead = 0
    while lead < len(out) and latin(out[lead]['text']):
        lead += 1
    if 0 < lead < len(out) and out[lead]['start'] - out[lead - 1]['end'] > 10:
        after = out[lead - 1]['end']
        spoken = [t['start'] / RATE for t in get_speech_timestamps(audio, VadOptions(min_silence_duration_ms=300)) if t['start'] / RATE > after]
        start = spoken[0] if spoken else after
        rest = [i for i in range(lead, len(out)) if out[i]['start'] >= start + 90]
        cut = rest[0] if rest else len(out)
        until = out[cut]['start'] if rest else len(audio) / RATE
        again = glue([g for g in heard(model, audio[int(start * RATE):int(until * RATE)], a.language, start) if g['start'] < until])
        # Heard apart, the pieces where the two hearings meet do not carry on each other's words.
        for p in again[:1] + out[cut:cut + 1]:
            p.pop('glued', None)
            if p['words']:
                p['words'][0] = p['words'][0][:3]
        out = out[:lead] + again + out[cut:]
    for piece in out:
        print(json.dumps(piece, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    sys.exit(main())
