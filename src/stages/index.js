'use strict';
const e = require('./editorial');
const x = require('./experiment'); const a = require('./audit'); const p = require('./production');
const f = require('./finishing'); const s = require('./shorts'); const c = require('./compliance');
module.exports = {
  strategy: e.strategy, ideation: e.ideation, selection: e.selection, experiment: x.experiment, research: e.research, script: e.script,
  factcheck: a.factcheck, narrative_review: a.narrative_review,
  storyboard: p.storyboard, media_rights: p.media_rights, voice: p.voice, align: p.align, scenes: p.scenes, edit: p.edit,
  captions: f.captions, thumbnail: f.thumbnail, seo: f.seo,
  shorts: s.shorts, provenance: c.provenance, qa: c.qa
};
