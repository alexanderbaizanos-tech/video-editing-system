import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { PROJECTS_DIR, UserError, ensureDir } from './util.js';

/** Settings every new project starts with. Edit project.json to change them. */
export function defaultProject(name, title) {
  return {
    name,
    title: title || name,
    subtitle: '',
    format: { width: 1920, height: 1080, fps: 30 },
    brand: { accent: '#ff5a36', logo: null },
    source: { file: null, tellaVideoId: null },
    edit: {
      trimStart: 0,
      trimEnd: null,
      cuts: [],
      cutSilence: { enabled: true, thresholdDb: -35, minSilence: 0.8, padding: 0.2 },
    },
    intro: { enabled: true, duration: 3 },
    lowerThird: { enabled: true, name: 'Your Name', role: 'Your role or channel', at: 1, duration: 5 },
    captions: { enabled: false, file: null, timing: 'source' },
    outro: { enabled: true, duration: 4, text: 'Thanks for watching', cta: 'Subscribe for more' },
    music: null,
    sfx: [],
    master: { lufs: -14, truePeak: -1 },
    render: { quality: 'looks', videoFrameFormat: 'auto' },
    exports: ['landscape'],
  };
}

export function projectDir(name) {
  if (!name) throw new UserError('Which project? Pass the project name, e.g. `node vedit.js prep my-video`.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new UserError(`"${name}" is not a valid project name. Use letters, numbers, dashes and underscores.`);
  }
  return join(PROJECTS_DIR, name);
}

export function paths(name) {
  const dir = projectDir(name);
  const build = join(dir, 'build');
  return {
    dir,
    file: join(dir, 'project.json'),
    raw: join(dir, 'raw'),
    music: join(dir, 'music'),
    sfx: join(dir, 'sfx'),
    assets: join(dir, 'assets'),
    build,
    exports: join(dir, 'exports'),
    main: join(build, 'main.mp4'),
    voice: join(build, 'voice.wav'),
    prep: join(build, 'prep.json'),
    transcript: join(build, 'transcript.json'),
    composition: join(build, 'index.html'),
    visual: join(build, 'visual.mp4'),
  };
}

export function createProject(name, { title } = {}) {
  const p = paths(name);
  if (existsSync(p.file)) throw new UserError(`Project "${name}" already exists at ${p.dir}`);
  for (const d of [p.raw, p.music, p.sfx, p.assets, p.build, p.exports]) ensureDir(d);
  const project = defaultProject(name, title);
  saveProject(project);
  return { project, paths: p };
}

/** Load project.json, filling in any settings missing from older files with defaults. */
export function loadProject(name) {
  const p = paths(name);
  if (!existsSync(p.file)) {
    throw new UserError(`No project called "${name}". Create it with: node vedit.js new ${name}`);
  }
  let data;
  try {
    data = JSON.parse(readFileSync(p.file, 'utf8'));
  } catch (err) {
    throw new UserError(`project.json for "${name}" is not valid JSON: ${err.message}`);
  }
  return mergeDefaults(defaultProject(name), data);
}

export function saveProject(project) {
  const p = paths(project.name);
  ensureDir(p.dir);
  writeFileSync(p.file, JSON.stringify(project, null, 2) + '\n');
}

function mergeDefaults(defaults, data) {
  const out = { ...defaults };
  for (const [key, value] of Object.entries(data)) {
    const d = defaults[key];
    out[key] =
      d && value && typeof d === 'object' && typeof value === 'object' && !Array.isArray(d) && !Array.isArray(value)
        ? mergeDefaults(d, value)
        : value;
  }
  return out;
}

export function readPrep(name) {
  const p = paths(name);
  if (!existsSync(p.prep)) throw new UserError(`Footage for "${name}" is not prepared yet. Run: node vedit.js prep ${name}`);
  return JSON.parse(readFileSync(p.prep, 'utf8'));
}

/**
 * Where each section sits on the final timeline, in seconds.
 * intro [0, mainStart) → footage [mainStart, outroStart) → outro [outroStart, total)
 */
export function timeline(project, mainDuration) {
  const introDuration = project.intro.enabled ? Number(project.intro.duration) : 0;
  const outroDuration = project.outro.enabled ? Number(project.outro.duration) : 0;
  const mainStart = introDuration;
  const outroStart = mainStart + mainDuration;
  return { introDuration, mainStart, mainDuration, outroStart, outroDuration, total: outroStart + outroDuration };
}

/**
 * Resolve a sound-effect time. Accepts seconds (12.5) or a section name with an
 * optional offset: "main", "main-0.3", "outro+0.5", "start", "end-2".
 */
export function resolveTime(at, tl) {
  if (typeof at === 'number') return at;
  const text = String(at).trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  const m = text.match(/^(start|main|outro|end)\s*([+-]\s*\d+(?:\.\d+)?)?$/);
  if (!m) throw new UserError(`Can't understand the time "${at}". Use seconds (12.5) or start/main/outro/end with an offset like "main-0.3".`);
  const anchors = { start: 0, main: tl.mainStart, outro: tl.outroStart, end: tl.total };
  const offset = m[2] ? Number(m[2].replace(/\s+/g, '')) : 0;
  return Math.max(0, anchors[m[1]] + offset);
}

export function safeFileName(name) {
  return basename(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
}
