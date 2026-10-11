import { mapRange } from './segments.js';

/** Parse "01:02:03,450", "02:03.450" or "3.45" into seconds. */
export function parseTimestamp(text) {
  const parts = text.trim().replace(',', '.').split(':').map(Number);
  if (parts.some(Number.isNaN)) throw new Error(`Bad timestamp: ${text}`);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Parse an .srt or .vtt subtitle file into [{ start, end, text }]. */
export function parseSubtitles(content) {
  const cues = [];
  const blocks = content.replace(/\r/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;
    const [a, b] = lines[timeIdx].split('-->');
    const text = lines
      .slice(timeIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    cues.push({ start: parseTimestamp(a), end: parseTimestamp(b.trim().split(/\s+/)[0]), text });
  }
  return cues;
}

/** Shift subtitle cues from source time onto the edited timeline, dropping cut-out lines. */
export function remapCues(cues, segments) {
  return cues
    .map((c) => {
      const r = mapRange(c.start, c.end, segments);
      return r && { ...r, text: c.text };
    })
    .filter(Boolean);
}

/**
 * Group word-level timestamps (from `hyperframes transcribe`) into readable
 * caption lines. Cue-level input (already sentences) passes through mostly as-is.
 */
export function groupWords(words, { maxChars = 42, maxGap = 0.6, maxDuration = 3.5 } = {}) {
  const lines = [];
  let cur = null;
  for (const w of words) {
    const text = String(w.text).trim();
    if (!text) continue;
    const fits =
      cur &&
      w.start - cur.end <= maxGap &&
      cur.text.length + 1 + text.length <= maxChars &&
      w.end - cur.start <= maxDuration &&
      !/[.!?]$/.test(cur.text);
    if (fits) {
      cur.text += ` ${text}`;
      cur.end = w.end;
    } else {
      if (cur) lines.push(cur);
      cur = { start: w.start, end: w.end, text };
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
