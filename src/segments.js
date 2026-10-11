// Pure helpers that decide which parts of the source recording to keep.
// A segment is { start, end } in source seconds.

/** Parse the `silencedetect` lines FFmpeg prints to stderr into [{ start, end }]. */
export function parseSilenceDetect(stderr, sourceDuration) {
  const silences = [];
  let open = null;
  for (const line of stderr.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) {
      open = Math.max(0, Number(s[1]));
      continue;
    }
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && open !== null) {
      silences.push({ start: open, end: Number(e[1]) });
      open = null;
    }
  }
  // A recording that ends in silence never prints silence_end.
  if (open !== null && sourceDuration !== undefined) silences.push({ start: open, end: sourceDuration });
  return silences;
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
