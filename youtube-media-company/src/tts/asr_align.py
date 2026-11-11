#!/usr/bin/env python3
"""
Alinhador/verificador local (faster-whisper). Duas provas:
 1) inteligibilidade da narracao (transcricao -> WER contra o roteiro);
 2) tempos REAIS por palavra, para que captions.srt nao seja estimativa.
O audio e lido direto com soundfile e entregue como vetor float32 em 16 kHz,
sem passar pelo decodificador interno (PyAV), que diverge de versao.
Uso: asr_align.py <wav_16k_mono> <saida.json> [modelo]
"""
import sys, json, os
os.environ.setdefault("OMP_NUM_THREADS", str(os.cpu_count() or 2))
import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

wav, out = sys.argv[1], sys.argv[2]
model_name = sys.argv[3] if len(sys.argv) > 3 else "base.en"

audio, sr = sf.read(wav, dtype="float32", always_2d=False)
if audio.ndim > 1:
    audio = audio.mean(axis=1)
if sr != 16000:
    raise SystemExit(f"esperado 16000 Hz, recebido {sr}: converta antes com ffmpeg")

model = WhisperModel(model_name, device="cpu", compute_type="int8")
segments, info = model.transcribe(audio, word_timestamps=True, vad_filter=False, beam_size=5, language="en")
words, segs = [], []
for s in segments:
    segs.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()})
    for w in (s.words or []):
        words.append({"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3),
                      "p": round(float(getattr(w, "probability", 0.0) or 0.0), 3)})
dur = round(len(audio) / 16000.0, 3)
json.dump({"model": model_name, "language": getattr(info, "language", "en"), "duration": dur,
           "segments": segs, "words": words}, open(out, "w"))
print(json.dumps({"ok": True, "words": len(words), "segments": len(segs), "duration": dur}))
