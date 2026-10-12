import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, basename, dirname, extname, resolve } from 'node:path';
import { PROJECTS_DIR, UserError, ensureDir, quoteArg } from './util.js';

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
      // thresholdDb "auto" = -35 dB, moved up for noisy rooms or down for quiet mics.
      cutSilence: { enabled: true, thresholdDb: 'auto', minSilence: 0.8, padding: 0.2 },
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

/**
 * Turn what the user typed into a project folder name. Accepts a plain name
 * ("My video") or a path to a folder inside projects/ ("projects\\My video\\").
 */
export function projectName(arg) {
  if (!arg) throw new UserError('Which project? Pass the project name, e.g. `node vedit.js prep my-video`.');
  let name = String(arg);
  if (/[\\/]/.test(name)) {
    const abs = resolve(name);
    const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    if (!same(dirname(abs), PROJECTS_DIR)) {
      throw new UserError(`"${arg}" is not a folder inside ${PROJECTS_DIR}. Put the video in a folder there and pass the folder name.`);
    }
    name = basename(abs);
  }
  // Folder names Windows and macOS both allow, minus anything that could reach outside projects/.
  if (!name.trim() || name.startsWith('.') || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    throw new UserError(`"${arg}" can't be used as a project folder name. Avoid < > : " / \\ | ? * and a leading or trailing dot.`);
  }
  return name;
}

export function projectDir(name) {
  return join(PROJECTS_DIR, projectName(name));
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

export function createProject(arg, { title } = {}) {
  const name = projectName(arg);
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
    throw new UserError(`No project called "${name}". Create it with: node vedit.js new ${quoteArg(name)}`);
  }
  let data;
  try {
    data = JSON.parse(readFileSync(p.file, 'utf8'));
  } catch (err) {
    throw new UserError(`project.json for "${name}" is not valid JSON: ${err.message}`);
  }
  // The folder is the source of truth for the name, so renaming a folder just works.
  return { ...mergeDefaults(defaultProject(projectName(name)), data), name: projectName(name) };
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi']);

/** Video files sitting in a project folder (its top level and raw/), as paths relative to it. */
export function findVideos(dir) {
  const found = [];
  for (const sub of ['', 'raw']) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).sort()) {
      if (VIDEO_EXTENSIONS.has(extname(f).toLowerCase()) && statSync(join(d, f)).isFile()) {
        found.push(sub ? `${sub}/${f}` : f);
      }
    }
  }
  return found;
}

/**
 * Load a project, or set one up for a folder someone made by hand and dropped a
 * video into. The video stays where it is; only project.json is added.
 */
export function adoptProject(arg, { file } = {}) {
  const name = projectName(arg);
  const p = paths(name);
  if (!existsSync(p.dir)) {
    throw new UserError(`There is no folder called "${name}" in ${PROJECTS_DIR}. Make it and put your video inside.`);
  }
  const project = existsSync(p.file) ? loadProject(name) : defaultProject(name);
  if (file) {
    if (!existsSync(join(p.dir, file))) throw new UserError(`"${file}" is not in ${p.dir}`);
    project.source = { ...project.source, file: file.replace(/\\/g, '/') };
  } else if (!project.source.file || !existsSync(join(p.dir, project.source.file))) {
    const videos = findVideos(p.dir);
    if (!videos.length) {
      throw new UserError(`No video found in ${p.dir}. Put the .mp4 or .mov file in that folder, or use \`tella pull\` / \`import\`.`);
    }
    if (videos.length > 1) {
      throw new UserError(
        `Found ${videos.length} videos in ${p.dir}:\n${videos.map((v) => `  ${v}`).join('\n')}\n` +
          `Pick one by adding --file, e.g. --file ${quoteArg(videos[0])}`,
      );
    }
    project.source = { ...project.source, file: videos[0] };
  }
  saveProject(project);
  return project;
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
