#!/usr/bin/env python3
"""
Worker de TTS local (Kokoro-82M, pesos Apache-2.0) para o youtube-media-company.
Carrega o modelo UMA vez e sintetiza por linha, lendo jobs JSON do stdin.
Protocolo: entrada = 1 JSON por linha {"id","text","out","voice","speed"}
           saida   = 1 JSON por linha {"id","ok","path","samples","sample_rate","seconds"} ou {"id","ok":false,"error"}
Primeira linha emitida: {"ready":true,"voices":[...]} ou {"ready":false,"error":...}
Zero chamada paga. Nenhum audio de terceiro, nenhuma voz clonada.
"""
import sys, json, os, warnings
warnings.filterwarnings("ignore")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

try:
    import numpy as np
    import soundfile as sf
    import torch
    torch.set_num_threads(max(1, (os.cpu_count() or 2)))
    from kokoro import KPipeline
    pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    import kokoro
    out({"ready": True, "engine": "kokoro", "version": getattr(kokoro, "__version__", "unknown"),
         "license": "Apache-2.0 (pesos hexgrad/Kokoro-82M)", "sample_rate": 24000})
except Exception as e:  # pragma: no cover
    out({"ready": False, "error": f"{type(e).__name__}: {e}"})
    sys.exit(3)

SR = 24000
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        job = json.loads(line)
    except Exception as e:
        out({"id": None, "ok": False, "error": f"json invalido: {e}"})
        continue
    if job.get("cmd") == "quit":
        break
    jid = job.get("id")
    try:
        text = (job.get("text") or "").strip()
        if not text:
            raise ValueError("texto vazio")
        voice = job.get("voice") or "am_michael"
        speed = float(job.get("speed") or 1.0)
        chunks = []
        for _gs, _ps, audio in pipeline(text, voice=voice, speed=speed):
            a = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
            chunks.append(np.asarray(a, dtype="float32").reshape(-1))
        if not chunks:
            raise RuntimeError("kokoro nao retornou audio")
        wav = np.concatenate(chunks)
        peak = float(np.max(np.abs(wav))) if wav.size else 0.0
        # normaliza para -3 dBFS, evitando clipping sem comprimir dinamica
        if peak > 0:
            wav = wav * (0.7079 / peak)
        os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
        sf.write(job["out"], wav, SR, subtype="PCM_16")
        out({"id": jid, "ok": True, "path": job["out"], "samples": int(wav.size),
             "sample_rate": SR, "seconds": round(wav.size / SR, 4), "raw_peak": round(peak, 5)})
    except Exception as e:
        out({"id": jid, "ok": False, "error": f"{type(e).__name__}: {e}"})
