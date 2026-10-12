import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, UserError, round } from './util.js';
import { parseLevels, findPauses, keepSegments, totalDuration, autoThreshold } from './segments.js';
import { resolveTime } from './project.js';

export async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate,avg_frame_rate',
    '-of', 'json',
    file,
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams.find((s) => s.codec_type === 'video');
  const audio = data.streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(data.format.duration),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: video?.width,
    height: video?.height,
    frameRate: video ? pickFrameRate(video.avg_frame_rate, video.r_frame_rate) : null,
  };
}

const STANDARD_RATES = ['24000/1001', '24', '25', '30000/1001', '30', '48', '50', '60000/1001', '60', '120'];

function rate(text) {
  const [n, d = '1'] = String(text ?? '').split('/');
  const v = Number(n) / Number(d);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The constant frame rate to edit at: the recording's own rate, snapped to the
 * nearest standard one (phones record slightly variable rates like 29.87).
 * Returns { expr: "30000/1001", value: 29.97… }.
 */
export function pickFrameRate(avg, r) {
  const v = rate(avg) ?? rate(r) ?? 30;
  const dist = (s) => Math.abs(rate(s) - v) / rate(s);
  const near = STANDARD_RATES.reduce((best, s) => (dist(s) < dist(best) ? s : best));
  if (dist(near) < 0.005) return { expr: near, value: rate(near) };
  const whole = Math.min(120, Math.max(1, Math.round(v)));
  return { expr: String(whole), value: whole };
}

let versionCache;
export async function ffmpegMajorVersion() {
  if (versionCache !== undefined) return versionCache;
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-version']);
  const m = stdout.match(/ffmpeg version n?(\d+)\./);
  versionCache = m ? Number(m[1]) : 7; // git builds print a hash; assume modern
  return versionCache;
}

/**
 * Pass a filter graph through a file so long edit lists don't hit command-line
 * length limits. FFmpeg 7 renamed the option, so pick the right spelling.
 */
async function filterFileArgs(graph, file) {
  writeFileSync(file, graph);
  return (await ffmpegMajorVersion()) >= 7 ? ['-/filter_complex', file] : ['-filter_complex_script', file];
}

const LEVEL_WINDOW = 0.05; // seconds per loudness reading

/** Loudness (dB RMS) of every 50 ms of the recording's audio: [{ t, db }]. */
export async function measureLevels(file) {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-nostats',
    '-i', file,
    '-map', '0:a:0',
    '-af', `aresample=16000,aformat=channel_layouts=mono,asetnsamples=n=${16000 * LEVEL_WINDOW}:p=0,` +
      'astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level',
    '-f', 'null', '-',
  ]);
  return parseLevels(stderr);
}

/**
 * Decide what to keep: trims, manual cuts and (if enabled) pauses.
 * Shared by `prep` (full pipeline) and `cut` (dead space only).
 */
async function planEdit({ source, info, edit, fps, onStatus }) {
  let silences = [];
  let thresholdDb = null;
  const cs = edit.cutSilence;
  if (cs?.enabled && info.hasAudio) {
    onStatus('Measuring loudness to find pauses…');
    const windows = await measureLevels(source);
    thresholdDb = Number(cs.thresholdDb);
    if (cs.thresholdDb === 'auto' || !Number.isFinite(thresholdDb)) {
      const auto = autoThreshold(windows.map((w) => w.db));
      thresholdDb = auto.thresholdDb;
      if (auto.noiseDb !== null) {
        onStatus(`Background ≈ ${auto.noiseDb} dB, talking ≈ ${auto.speechDb} dB → treating audio below ${thresholdDb} dB as a pause`);
      }
      if (!auto.clear) {
        onStatus('! Talking is barely louder than the background noise, so some pauses may be missed.');
      }
    }
    silences = findPauses(windows, { thresholdDb, minSilence: Number(cs.minSilence ?? 0.8), windowSec: LEVEL_WINDOW, duration: info.duration });
  }

  const segments = keepSegments({
    duration: info.duration,
    trimStart: edit.trimStart,
    trimEnd: edit.trimEnd,
    cuts: edit.cuts,
    silences,
    padding: cs?.padding ?? 0.2,
    fps,
  });
  if (!segments.length) throw new UserError('Nothing left after trimming and cutting. Check edit.trimStart, edit.trimEnd and edit.cuts.');
  return { segments, silences, thresholdDb, duration: totalDuration(segments) };
}

/**
 * Filter graph that keeps the chosen segments and joins them.
 * - scale: { width, height } to letterbox into the project canvas, or null to keep the original size
 * - cleanVoice: rumble filter, compression and loudness normalisation for the voice
 */
export function editGraph({ segments, fps, audioInput, scale = null, cleanVoice = false }) {
  const n = segments.length;
  const fpsValue = rate(fps);
  const picture = scale
    ? `scale=${scale.width}:${scale.height}:force_original_aspect_ratio=decrease,` +
      `pad=${scale.width}:${scale.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
    : 'scale=trunc(iw/2)*2:trunc(ih/2)*2'; // H.264 needs even dimensions
  const audioFormat = scale ? 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,' : '';
  const lines = [
    `[0:v]fps=${fps},${picture},format=yuv420p,split=${n}${labels('v', n)}`,
    `[${audioInput}]${audioFormat}asplit=${n}${labels('a', n)}`,
  ];
  // Cut exactly on frame boundaries so every segment holds a whole number of
  // frames and exactly the same length of audio: no drift across many cuts.
  // (trim keeps any frame that overlaps the range, so an off-grid cut point
  // would pull in an extra frame.)
  // (FFmpeg reads times to the microsecond, so print them that way.)
  const edge = (t) => Number((Math.round(t * fpsValue) / fpsValue).toFixed(6));
  segments.forEach((s, i) => {
    const a = edge(s.start);
    const b = edge(s.end);
    lines.push(`[v${i}]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[sv${i}]`);
    lines.push(`[a${i}]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[sa${i}]`);
  });
  const pairs = segments.map((_, i) => `[sv${i}][sa${i}]`).join('');
  lines.push(`${pairs}concat=n=${n}:v=1:a=1[vout][acat]`);
  lines.push(
    cleanVoice
      ? // Voice clean-up: remove rumble, even out levels, normalise to -16 LUFS.
        '[acat]highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=10:release=200,' +
          'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]'
      : '[acat]anull[aout]',
  );
  return lines.join(';\n');
}

function labels(prefix, n) {
  return Array.from({ length: n }, (_, i) => `[${prefix}${i}]`).join('');
}

function inputsFor(source, info) {
  const inputs = ['-i', source];
  if (info.hasAudio) return { inputs, audioInput: '0:a:0' };
  inputs.push('-f', 'lavfi', '-t', String(info.duration), '-i', 'anullsrc=r=48000:cl=stereo');
  return { inputs, audioInput: '1:a' };
}

function editSummary(info, plan) {
  return {
    sourceDuration: round(info.duration),
    duration: plan.duration,
    removedSeconds: round(info.duration - plan.duration),
    silencesDetected: plan.silences.length,
    thresholdDb: plan.thresholdDb,
    segments: plan.segments,
  };
}

/**
 * Step 1 of the full pipeline: conform the recording (resolution, frame rate),
 * cut pauses and manual cuts, clean up the voice. Produces main.mp4 (picture)
 * and voice.wav (sound) plus prep.json describing the edit.
 */
export async function prepFootage({ source, project, paths, onStatus = () => {} }) {
  const info = await probe(source);
  if (!info.hasVideo) throw new UserError(`${source} has no video stream.`);
  const { width, height, fps } = project.format;

  const plan = await planEdit({ source, info, edit: project.edit, fps, onStatus });
  onStatus(
    `Keeping ${plan.segments.length} segment(s): ${round(plan.duration, 1)}s of ${round(info.duration, 1)}s ` +
      `(${round(info.duration - plan.duration, 1)}s removed)`,
  );

  const { inputs, audioInput } = inputsFor(source, info);
  const graph = editGraph({ segments: plan.segments, fps: String(fps), audioInput, scale: { width, height }, cleanVoice: true });
  const filterArgs = await filterFileArgs(graph, join(paths.build, 'prep.filtergraph.txt'));

  onStatus('Encoding cleaned-up footage…');
  await run('ffmpeg', [
    '-hide_banner', '-y', '-loglevel', 'error',
    ...inputs,
    ...filterArgs,
    // A keyframe every second keeps HyperFrames' frame-accurate seeking fast and freeze-free.
    '-map', '[vout]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-r', String(fps),
    '-g', String(fps), '-keyint_min', String(fps),
    '-movflags', '+faststart', paths.main,
    '-map', '[aout]', '-vn', '-c:a', 'pcm_s16le', '-ar', '48000', paths.voice,
  ]);

  const prep = { source, ...editSummary(info, plan), format: { width, height, fps }, preparedAt: new Date().toISOString() };
  writeFileSync(paths.prep, JSON.stringify(prep, null, 2) + '\n');
  return prep;
}

/**
 * Dead-space removal only: cut pauses (plus any trims/cuts in project.json)
 * and nothing else. Size, frame rate and sound stay as recorded.
 */
export async function cutFootage({ source, project, workDir, output, onStatus = () => {} }) {
  const info = await probe(source);
  if (!info.hasVideo) throw new UserError(`${source} has no video stream.`);
  if (!info.hasAudio) onStatus('! This video has no sound, so there are no pauses to find. Only trims and cuts from project.json apply.');
  const fps = info.frameRate;

  const plan = await planEdit({ source, info, edit: project.edit, fps: fps.value, onStatus });
  const { inputs, audioInput } = inputsFor(source, info);
  const graph = editGraph({ segments: plan.segments, fps: fps.expr, audioInput });
  const filterArgs = await filterFileArgs(graph, join(workDir, 'cut.filtergraph.txt'));

  onStatus(`Encoding ${info.width}x${info.height} at ${round(fps.value, 2)} fps (this is the slow part)…`);
  await run('ffmpeg', [
    '-hide_banner', '-y', '-loglevel', 'error',
    ...inputs,
    ...filterArgs,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    output,
  ]);

  const summary = { source, output, ...editSummary(info, plan), frameRate: fps.expr, cutAt: new Date().toISOString() };
  writeFileSync(join(workDir, 'cut.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

/**
 * Audio graph for the final mix: voice placed after the intro, music bed under
 * it (ducked whenever you talk), sound effects at their cue times.
 * Ends in [mix]; loudness mastering is appended by the caller.
 */
export function mixGraph({ project, tl, musicInput, sfxInputs }) {
  const total = round(tl.total);
  const delayMs = Math.round(tl.mainStart * 1000);
  const music = project.music;
  const lines = [];
  const mixInputs = ['[voice]'];

  const voiceChain = `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}:all=1,apad,atrim=0:${total}`;
  const duck = musicInput !== null && music?.duck !== false;
  lines.push(duck ? `${voiceChain},asplit=2[voice][sidechain]` : `${voiceChain}[voice]`);

  if (musicInput !== null) {
    const fadeIn = Number(music.fadeIn ?? 1);
    const fadeOut = Math.min(Number(music.fadeOut ?? 3), total);
    // Bring every track to the same loudness first so volumeDb means
    // "this much quieter than the voice" no matter how the track was mastered.
    lines.push(
      `[${musicInput}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${total},asetpts=PTS-STARTPTS,` +
        `loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,volume=${Number(music.volumeDb ?? -10)}dB,` +
        `afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${round(total - fadeOut)}:d=${fadeOut}` +
        (duck ? '[bed]' : '[music]'),
    );
    if (duck) {
      lines.push(
        `[bed][sidechain]sidechaincompress=threshold=${Number(music.duckThreshold ?? 0.02)}:ratio=${Number(music.duckRatio ?? 8)}:attack=20:release=400[music]`,
      );
    }
    mixInputs.push('[music]');
  }

  sfxInputs.forEach(({ input, sfx }, i) => {
    const at = resolveTime(sfx.at, tl);
    lines.push(
      `[${input}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${Number(sfx.volumeDb ?? -6)}dB,` +
        `adelay=${Math.round(at * 1000)}:all=1[sfx${i}]`,
    );
    mixInputs.push(`[sfx${i}]`);
  });

  lines.push(
    mixInputs.length > 1
      ? `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0,atrim=0:${total}[mix]`
      : `[voice]anull[mix]`,
  );
  return lines.join(';\n');
}

/** Parse the JSON block loudnorm prints on its measurement pass. */
export function parseLoudnorm(stderr) {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end < start) throw new UserError('Could not read loudness measurement from FFmpeg.');
  return JSON.parse(stderr.slice(start, end + 1));
}

/**
 * Final mix and loudness master (two-pass loudnorm, the accurate way).
 * Takes the silent HyperFrames render and lays the finished soundtrack under it.
 */
export async function master({ project, paths, tl, output, onStatus = () => {} }) {
  const inputs = ['-i', paths.visual, '-i', paths.voice];
  let next = 2;
  let musicInput = null;
  if (project.music?.file) {
    const file = join(paths.dir, project.music.file);
    if (!existsSync(file)) throw new UserError(`Music file not found: ${file}`);
    inputs.push('-stream_loop', '-1', '-i', file); // loop short tracks to fill the video
    musicInput = next++;
  }
  const sfxInputs = [];
  for (const sfx of project.sfx ?? []) {
    const file = join(paths.dir, sfx.file);
    if (!existsSync(file)) throw new UserError(`Sound effect not found: ${file}`);
    inputs.push('-i', file);
    sfxInputs.push({ input: next++, sfx });
  }

  const { lufs, truePeak } = project.master;
  const base = mixGraph({ project, tl, musicInput, sfxInputs });

  onStatus('Measuring loudness…');
  const measureArgs = await filterFileArgs(
    `${base};\n[mix]loudnorm=I=${lufs}:TP=${truePeak}:LRA=11:print_format=json[out]`,
    join(paths.build, 'mix-measure.filtergraph.txt'),
  );
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', ...inputs, ...measureArgs, '-map', '[out]', '-f', 'null', '-']);
  const m = parseLoudnorm(stderr);

  onStatus(`Mixing and mastering to ${lufs} LUFS…`);
  const finalArgs = await filterFileArgs(
    `${base};\n[mix]loudnorm=I=${lufs}:TP=${truePeak}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
      `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000[out]`,
    join(paths.build, 'mix.filtergraph.txt'),
  );
  await run('ffmpeg', [
    '-hide_banner', '-y', '-loglevel', 'error',
    ...inputs,
    ...finalArgs,
    '-map', '0:v:0', '-map', '[out]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', String(round(tl.total)),
    '-movflags', '+faststart',
    output,
  ]);
  return { measuredLufs: Number(m.input_i) };
}

export const EXPORT_SIZES = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

/** Re-frame the finished video for Shorts/Reels/TikTok: video centred over a blurred, zoomed copy of itself. */
export async function reframe(input, output, { width, height }) {
  const graph =
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=40:2,eq=brightness=-0.08[bgb];` +
    `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgs];` +
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`;
  await run('ffmpeg', [
    '-hide_banner', '-y', '-loglevel', 'error',
    '-i', input,
    '-filter_complex', graph,
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'copy',
    '-movflags', '+faststart',
    output,
  ]);
}

export async function thumbnail(input, output, atSeconds) {
  await run('ffmpeg', ['-hide_banner', '-y', '-loglevel', 'error', '-ss', String(atSeconds), '-i', input, '-frames:v', '1', '-q:v', '2', output]);
}
