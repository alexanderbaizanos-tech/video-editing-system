// Pure helpers that decide which parts of the source recording to keep.
// A segment is { start, end } in source seconds.

/**
 * Parse the loudness readings FFmpeg prints with
 * `astats=metadata=1:reset=1,ametadata=mode=print` into [{ t, db }]:
 * one entry per short window, t = window start in seconds.
 */
export function parseLevels(stderr) {
  const windows = [];
  let t = null;
  for (const line of stderr.split('\n')) {
    const time = line.match(/pts_time:\s*(-?[\d.]+)/);
    if (time) {
      t = Number(time[1]);
      continue;
    }
    const level = line.match(/lavfi\.astats\.Overall\.RMS_level=(\S+)/);
    if (level && t !== null) {
      const db = Number(level[1].replace('inf', 'Infinity'));
      windows.push({ t, db: Number.isFinite(db) ? db : -120 });
      t = null;
    }
  }
  return windows;
}

/**
 * Pauses = runs of consecutive windows quieter than thresholdDb lasting at
 * least minSilence seconds. Working on short-window loudness (not single
 * samples) means a stray click or noise spike can't break up a pause.
 */
export function findPauses(windows, { thresholdDb, minSilence, windowSec, duration = Infinity }) {
  const pauses = [];
  let start = null;
  let end = null;
  const close = () => {
    if (start !== null && end - start >= minSilence - 1e-9) pauses.push({ start, end: Math.min(end, duration) });
    start = null;
  };
  for (const w of windows) {
    if (w.db < thresholdDb) {
      if (start === null) start = w.t;
      end = w.t + windowSec;
    } else {
      close();
    }
  }
  close();
  return pauses;
}

/**
 * Work out which parts of the recording survive the edit.
 *
 * @param {object} o
 * @param {number} o.duration        length of the source in seconds
 * @param {number} [o.trimStart]     drop everything before this
 * @param {number|null} [o.trimEnd]  drop everything after this
 * @param {{from:number,to:number}[]} [o.cuts]  manual cuts in source time
 * @param {{start:number,end:number}[]} [o.silences] detected pauses
 * @param {number} [o.padding]       seconds of each pause to keep on both sides, so cuts don't clip words
 * @param {number} [o.fps]           snap cut points to frame boundaries so audio and video stay in sync
 * @param {number} [o.minSegment]    drop kept pieces shorter than this (blips between pauses)
 */
export function keepSegments({
  duration,
  trimStart = 0,
  trimEnd = null,
  cuts = [],
  silences = [],
  padding = 0.2,
  fps = 30,
  minSegment = 0.25,
}) {
  const start = clamp(Number(trimStart) || 0, 0, duration);
  const end = clamp(trimEnd == null ? duration : Number(trimEnd), start, duration);

  const removed = [
    ...cuts.map((c) => ({ start: Number(c.from), end: Number(c.to) })),
    ...silences
      .map((s) => ({ start: s.start + padding, end: s.end - padding }))
      .filter((s) => s.end - s.start > 0),
  ]
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  let keep = [{ start, end }];
  for (const r of removed) {
    keep = keep.flatMap((k) => {
      if (r.end <= k.start || r.start >= k.end) return [k];
      const parts = [];
      if (r.start > k.start) parts.push({ start: k.start, end: r.start });
      if (r.end < k.end) parts.push({ start: r.end, end: k.end });
      return parts;
    });
  }

  const snap = (t) => Math.round(t * fps) / fps;
  const segments = keep
    .map((k) => ({ start: snap(k.start), end: snap(k.end) }))
    .filter((k) => k.end - k.start >= minSegment);

  let out = 0;
  return segments.map((s) => {
    const seg = { start: round(s.start), end: round(s.end), outStart: round(out) };
    out += s.end - s.start;
    return seg;
  });
}

export function totalDuration(segments) {
  return round(segments.reduce((sum, s) => sum + (s.end - s.start), 0));
}

/**
 * Map a source-time range onto the edited timeline. Returns null when the
 * range was cut out entirely. Used to keep subtitle files in sync after cuts.
 */
export function mapRange(start, end, segments) {
  let outStart = null;
  let outEnd = null;
  for (const s of segments) {
    if (end <= s.start || start >= s.end) continue;
    const a = Math.max(start, s.start);
    const b = Math.min(end, s.end);
    if (outStart === null) outStart = s.outStart + (a - s.start);
    outEnd = s.outStart + (b - s.start);
  }
  if (outStart === null || outEnd - outStart < 0.05) return null;
  return { start: round(outStart), end: round(outEnd) };
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

/** The p-th percentile (0–100) of a list of numbers. */
export function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Pick the level below which audio counts as a pause, from loudness readings
 * of short windows across the recording (dB RMS, one per 100 ms).
 *
 * Starts from `base` (-35 dB suits most mics), then keeps it at least 6 dB
 * above the background noise (noisy rooms) and at least 15 dB below normal
 * talking level (quiet mics), so neither case cuts everything or nothing.
 */
export function autoThreshold(levels, base = -35) {
  const vals = levels.map((v) => (Number.isFinite(v) ? v : -120));
  if (vals.length < 20) return { thresholdDb: base, noiseDb: null, speechDb: null, clear: true };
  const noiseDb = percentile(vals, 10);
  const speechDb = percentile(vals, 75);
  const lo = noiseDb + 6;
  const hi = speechDb - 15;
  const thresholdDb = lo <= hi ? Math.min(hi, Math.max(lo, base)) : noiseDb + 0.4 * (speechDb - noiseDb);
  return {
    thresholdDb: Math.round(thresholdDb * 10) / 10,
    noiseDb: Math.round(noiseDb * 10) / 10,
    speechDb: Math.round(speechDb * 10) / 10,
    // Under ~12 dB between talking and background, pauses are hard to tell apart.
    clear: speechDb - noiseDb >= 12,
  };
}
