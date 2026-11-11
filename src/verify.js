'use strict';
/** Verificacao independente do pipeline: le o disco, nao o store. */
const fs = require('fs');
const path = require('path');
const { probe, fullDecodeCheck, audioStats } = require('./media');
async function verifyEpisode(channelId, epId) {
  const base = path.join(__dirname, '..', 'content', 'channels', channelId, 'episodes', epId);
  const out = { base, exists: fs.existsSync(base), files: {}, shorts: [] };
  for (const f of ['video_long_1080p.mp4', 'narration.wav', 'captions.srt', 'thumbnail_A.png', 'thumbnail_B.png',
    'script_en.md', 'sources.json', 'claims_review.md', 'storyboard.json', 'metadata.json', 'provenance.json', 'quality_report.json']) {
    const p = path.join(base, f);
    out.files[f] = fs.existsSync(p) ? { bytes: fs.statSync(p).size } : 'AUSENTE';
  }
  const v = path.join(base, 'video_long_1080p.mp4');
  if (fs.existsSync(v)) {
    out.video = await probe(v); out.decode = await fullDecodeCheck(v); out.audio_stats = await audioStats(v);
  }
  const sd = path.join(base, 'shorts');
  if (fs.existsSync(sd)) for (const f of fs.readdirSync(sd).filter((x) => x.endsWith('.mp4'))) {
    out.shorts.push({ file: f, ...(await probe(path.join(sd, f))) });
  }
  return out;
}
module.exports = { verifyEpisode };
