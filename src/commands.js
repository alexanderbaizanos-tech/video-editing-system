import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { UserError, log, hyperframes, downloadFile, formatTime, round, ensureDir, quoteArg } from './util.js';
import { createProject, loadProject, saveProject, adoptProject, paths, readPrep, timeline, resolveTime, safeFileName } from './project.js';
import { prepFootage, cutFootage, master, reframe, thumbnail, EXPORT_SIZES } from './ffmpeg.js';
import { buildComposition } from './compose.js';
import { TellaClient } from './tella.js';

export function cmdNew([name], opts) {
  const { project, paths: p } = createProject(name, { title: opts.title });
  const q = quoteArg(project.name);
  log.ok(`Created project "${project.name}"`);
  log.info(`Folder:   ${p.dir}`);
  log.info(`Settings: ${p.file}`);
  log.info('');
  log.info('Next, add your recording:');
  log.info(`  from Tella:     node vedit.js tella pull ${q} <tella-video-id>`);
  log.info(`  from a file:    node vedit.js import ${q} path/to/recording.mp4`);
}

/** Remove dead space and nothing else: one FFmpeg pass, original size, frame rate and sound. */
export async function cmdCut([name], opts) {
  const project = adoptProject(name, { file: opts.file });
  const p = paths(project.name);
  const source = join(p.dir, project.source.file);
  ensureDir(p.build);
  ensureDir(p.exports);
  const output = join(p.exports, `${project.name} - cut.mp4`);

  log.step(`Removing dead space from ${project.source.file}`);
  const r = await cutFootage({ source, project, workDir: p.build, output, onStatus: log.info });
  const pct = r.sourceDuration ? Math.round((r.removedSeconds / r.sourceDuration) * 100) : 0;
  log.ok(output);
  log.info(`${formatTime(r.sourceDuration)} → ${formatTime(r.duration)}: removed ${formatTime(r.removedSeconds)} (${pct}%) from ${r.silencesDetected} pause(s)`);
  log.info('');
  log.info(`Tune it in ${p.file} → "edit" → "cutSilence", then run this again:`);
  log.info('  feels choppy / words clipped:   raise "padding" to 0.3, or "minSilence" to 1.2');
  log.info('  still too many pauses:          lower "minSilence" to 0.5');
}

export function cmdImport([name, file]) {
  const project = loadProject(name);
  const p = paths(name);
  if (!file) throw new UserError('Usage: node vedit.js import <project> <video-file>');
  const src = resolve(file);
  if (!existsSync(src)) throw new UserError(`File not found: ${src}`);
  const dest = join(p.raw, safeFileName(src));
  if (src !== dest) copyFileSync(src, dest);
  project.source = { ...project.source, file: `raw/${safeFileName(src)}` };
  saveProject(project);
  log.ok(`Imported ${src} → ${dest}`);
  log.info(`Next: node vedit.js prep ${name}`);
}

export async function cmdTella([sub, ...rest], opts) {
  const client = new TellaClient();
  if (sub === 'list') {
    const videos = await client.listVideos({ limit: Number(opts.limit) || 20 });
    if (!videos.length) return log.info('No videos found in your Tella workspace.');
    log.step(`Your Tella videos (newest first)`);
    for (const v of videos) {
      const dur = v.durationSeconds ? formatTime(v.durationSeconds) : '?';
      console.log(`  ${v.id}  ${dur.padStart(7)}  ${v.name ?? v.title ?? '(untitled)'}`);
    }
    log.info('');
    log.info('Pull one into a project with: node vedit.js tella pull <project> <video-id>');
    return;
  }
  if (sub === 'pull') {
    const [name, videoId] = rest;
    if (!name || !videoId) throw new UserError('Usage: node vedit.js tella pull <project> <tella-video-id>');
    const project = loadProject(name);
    const p = paths(name);
    log.step(`Exporting Tella video ${videoId}`);
    const options = { granularity: opts.granularity || 'video' };
    const result = await client.exportAndWait(videoId, {
      options,
      onStatus: (e) => log.info(`status: ${e.status ?? 'processing'}${e.progress != null ? ` (${e.progress}%)` : ''}`),
    });
    const dest = join(p.raw, `tella-${safeFileName(videoId)}.mp4`);
    log.info('Downloading…');
    let lastPct = -10;
    await client.download(result.downloadUrl, dest, {
      onProgress: (got, total) => {
        const pct = total ? Math.floor((got / total) * 100) : null;
        if (pct !== null && pct >= lastPct + 10) {
          lastPct = pct;
          log.info(`${pct}%`);
        }
      },
    });
    project.source = { file: `raw/tella-${safeFileName(videoId)}.mp4`, tellaVideoId: videoId };
    saveProject(project);
    log.ok(`Saved ${dest}`);
    log.info(`Next: node vedit.js prep ${name}`);
    return;
  }
  throw new UserError('Usage: node vedit.js tella list | node vedit.js tella pull <project> <video-id>');
}

/** Copy or download an Epidemic Sound file into the project and record the licence details. */
async function addAudio({ name, input, kind, opts }) {
  if (!input) throw new UserError(`Usage: node vedit.js ${kind} add <project> <file-or-url> [--title ..] [--artist ..] [--id ..]`);
  const project = loadProject(name);
  const p = paths(name);
  const dir = kind === 'music' ? p.music : p.sfx;
  ensureDir(dir);

  let fileName;
  if (/^https?:\/\//i.test(input)) {
    const ext = opts.ext ? `.${String(opts.ext).replace(/^\./, '')}` : extname(new URL(input).pathname) || '.mp3';
    fileName = safeFileName(`${opts.title || opts.id || `${kind}-${Date.now()}`}${ext}`);
    log.info(`Downloading ${kind}…`);
    await downloadFile(input, join(dir, fileName));
  } else {
    const src = resolve(input);
    if (!existsSync(src)) throw new UserError(`File not found: ${src}`);
    fileName = safeFileName(src);
    if (src !== join(dir, fileName)) copyFileSync(src, join(dir, fileName));
  }

  const credit = {
    source: 'Epidemic Sound',
    ...(opts.id ? { id: String(opts.id) } : {}),
    ...(opts.title ? { title: String(opts.title) } : {}),
    ...(opts.artist ? { artist: String(opts.artist) } : {}),
  };
  const rel = `${kind}/${fileName}`;

  if (kind === 'music') {
    project.music = {
      file: rel,
      volumeDb: opts.volume !== undefined ? Number(opts.volume) : project.music?.volumeDb ?? -10,
      duck: project.music?.duck ?? true,
      fadeIn: project.music?.fadeIn ?? 1,
      fadeOut: project.music?.fadeOut ?? 3,
      credit,
    };
    log.ok(`Music set to ${rel}`);
  } else {
    if (opts.at === undefined) throw new UserError('Sound effects need a time: --at 12.5 or --at main-0.3 (see docs/SETUP.md).');
    resolveTime(opts.at, { mainStart: 0, outroStart: 0, total: 0 }); // validate early
    project.sfx = [...(project.sfx ?? []), { file: rel, at: isNaN(Number(opts.at)) ? opts.at : Number(opts.at), volumeDb: Number(opts.volume ?? -6), credit }];
    log.ok(`Added sound effect ${rel} at ${opts.at}`);
  }
  saveProject(project);
}

export function cmdMusic([sub, name, input], opts) {
  if (sub !== 'add') throw new UserError('Usage: node vedit.js music add <project> <file-or-url> [--title ..] [--artist ..] [--id ..] [--volume -10]');
  return addAudio({ name, input, kind: 'music', opts });
}

export function cmdSfx([sub, name, input], opts) {
  if (sub !== 'add') throw new UserError('Usage: node vedit.js sfx add <project> <file-or-url> --at <time> [--volume -6] [--title ..] [--id ..]');
  return addAudio({ name, input, kind: 'sfx', opts });
}

export function cmdInfo([name], opts) {
  const project = loadProject(name);
  const p = paths(name);
  const prep = existsSync(p.prep) ? readPrep(name) : null;
  const tl = prep ? timeline(project, prep.duration) : null;
  if (opts.json) {
    console.log(JSON.stringify({ project, prep, timeline: tl }, null, 2));
    return;
  }
  log.step(`Project "${name}" — ${project.title}`);
  log.info(`Source:   ${project.source.file ?? '(none yet — use tella pull or import)'}`);
  if (prep) {
    log.info(`Footage:  ${formatTime(prep.duration)} after edits (${round(prep.removedSeconds, 1)}s of pauses/cuts removed)`);
    log.info(`Timeline: intro ${tl.introDuration}s → footage → outro ${tl.outroDuration}s = ${formatTime(tl.total)} total (${Math.round(tl.total * 1000)} ms)`);
  } else {
    log.info('Footage:  not prepared yet (node vedit.js prep ' + name + ')');
  }
  log.info(`Music:    ${project.music?.file ?? '(none)'}`);
  log.info(`SFX:      ${project.sfx?.length ? project.sfx.map((s) => `${s.file}@${s.at}`).join(', ') : '(none)'}`);
  log.info(`Captions: ${project.captions.enabled ? project.captions.file ?? 'auto-transcribe' : 'off'}`);
  log.info(`Exports:  ${project.exports.join(', ')}`);
}

export async function cmdPrep([name], opts = {}) {
  const project = adoptProject(name, { file: opts.file });
  const p = paths(project.name);
  const source = join(p.dir, project.source.file);
  if (!existsSync(source)) throw new UserError(`Recording not found: ${source}`);
  ensureDir(p.build);
  log.step(`Preparing footage with FFmpeg`);
  const prep = await prepFootage({ source, project, paths: p, onStatus: log.info });
  log.ok(`main.mp4 + voice.wav ready (${formatTime(prep.duration)})`);
}

export async function cmdBuild([name]) {
  const project = loadProject(name);
  const p = paths(name);
  log.step('Building HyperFrames composition');
  const { tl, captions } = await buildComposition({ project, paths: p, onStatus: log.info });
  log.ok(`Wrote HyperFrames project in ${p.build}`);
  log.info(`Length ${formatTime(tl.total)}${captions ? `, ${captions} caption lines` : ''}`);
  const lint = await hyperframes(['lint', p.build], { allowFail: true });
  const summary = (lint.stdout + lint.stderr).replace(/\x1b\[[0-9;]*m/g, '').split('\n').find((l) => /\d+ error/.test(l));
  if (summary) log.info(`HyperFrames lint: ${summary.replace(/^[^0-9]*/, '')}`);
  if (lint.code !== 0) log.warn(`Lint reported problems. See them with: npx hyperframes lint "${p.build}"`);
}

export async function cmdPreview([name]) {
  const p = paths(name);
  loadProject(name);
  if (!existsSync(p.composition)) throw new UserError(`Build the composition first: node vedit.js build ${name}`);
  log.step('Opening HyperFrames Studio (Ctrl+C to stop)');
  log.info('Preview sound is a rough mix; the final export gets ducking and loudness mastering.');
  await hyperframes(['preview', p.build], { inherit: true });
}

export async function cmdRender([name], opts) {
  const project = loadProject(name);
  const p = paths(name);
  if (!existsSync(p.composition)) throw new UserError(`Build the composition first: node vedit.js build ${name}`);
  const prep = readPrep(name);
  const tl = timeline(project, prep.duration);
  ensureDir(p.exports);

  log.step(`Rendering graphics + footage with HyperFrames (${formatTime(tl.total)} of video, this takes a while)`);
  const quality = opts.draft ? 'draft' : project.render.quality;
  await hyperframes(
    ['render', p.build, '--output', p.visual, '--quality', quality, '--fps', String(project.format.fps),
      '--video-frame-format', project.render.videoFrameFormat || 'auto', '--quiet'],
    { inherit: true },
  );

  log.step('Mixing soundtrack and mastering with FFmpeg');
  const finalFile = join(p.exports, `${name}${opts.draft ? '-draft' : ''}.mp4`);
  const { measuredLufs } = await master({ project, paths: p, tl, output: finalFile, onStatus: log.info });
  log.ok(`${finalFile} (mix measured ${measuredLufs} LUFS before mastering)`);

  if (!opts.draft && !opts['no-exports']) {
    for (const kind of project.exports) {
      if (kind === 'landscape') continue;
      const size = EXPORT_SIZES[kind];
      if (!size) {
        log.warn(`Unknown export "${kind}" (use landscape, vertical or square)`);
        continue;
      }
      const out = join(p.exports, `${name}-${kind}.mp4`);
      log.info(`Re-framing for ${kind} (${size.width}x${size.height})…`);
      await reframe(finalFile, out, size);
      log.ok(out);
    }
    const thumb = join(p.exports, `${name}-thumbnail.jpg`);
    await thumbnail(finalFile, thumb, tl.introDuration > 0 ? Math.min(1.5, tl.introDuration - 0.5) : 1);
    log.ok(thumb);
  }

  writeCredits(project, p);
}

function writeCredits(project, p) {
  const items = [project.music, ...(project.sfx ?? [])].filter((x) => x?.credit);
  if (!items.length) return;
  const lines = items.map(({ credit, file }) => {
    const what = [credit.title, credit.artist && `by ${credit.artist}`].filter(Boolean).join(' ') || file;
    return `${what} — ${credit.source}${credit.id ? ` (id ${credit.id})` : ''}`;
  });
  const out = join(p.exports, 'CREDITS.txt');
  writeFileSync(out, `Music and sound effects\n\n${lines.join('\n')}\n`);
  log.ok(`${out} (paste into your video description if you like)`);
}

export async function cmdAll(args, opts) {
  await cmdPrep(args, opts);
  await cmdBuild(args, opts);
  await cmdRender(args, opts);
}
