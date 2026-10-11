import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSilenceDetect, keepSegments, totalDuration, mapRange } from '../src/segments.js';

const STDERR = `
[silencedetect @ 0x1] silence_start: 2.6
[silencedetect @ 0x1] silence_end: 4 | silence_duration: 1.4
[silencedetect @ 0x1] silence_start: -0.01
[silencedetect @ 0x1] silence_end: 0.5 | silence_duration: 0.51
[silencedetect @ 0x1] silence_start: 12.2
`;

test('parses silencedetect output, closing a trailing silence at the end of the file', () => {
  assert.deepEqual(parseSilenceDetect(STDERR, 14), [
    { start: 2.6, end: 4 },
    { start: 0, end: 0.5 },
    { start: 12.2, end: 14 },
  ]);
});

test('keeps everything when there is nothing to cut', () => {
  assert.deepEqual(keepSegments({ duration: 10 }), [{ start: 0, end: 10, outStart: 0 }]);
});

test('cuts pauses but leaves padding on both sides', () => {
  const segs = keepSegments({ duration: 14, silences: [{ start: 2.6, end: 4 }], padding: 0.2 });
  assert.deepEqual(segs, [
    { start: 0, end: 2.8, outStart: 0 },
    { start: 3.8, end: 14, outStart: 2.8 },
  ]);
  assert.equal(totalDuration(segs), 13);
});

test('pauses shorter than twice the padding are left alone', () => {
  const segs = keepSegments({ duration: 10, silences: [{ start: 5, end: 5.3 }], padding: 0.2 });
  assert.equal(segs.length, 1);
});

test('applies trims and manual cuts together with silences', () => {
  const segs = keepSegments({
    duration: 30,
    trimStart: 2,
    trimEnd: 25,
    cuts: [{ from: 10, to: 12 }],
    silences: [{ start: 18, end: 20 }],
    padding: 0,
  });
  assert.deepEqual(
    segs.map((s) => [s.start, s.end]),
    [[2, 10], [12, 18], [20, 25]],
  );
  assert.equal(totalDuration(segs), 19);
});

test('snaps cut points to whole frames (stored to the millisecond)', () => {
  const segs = keepSegments({ duration: 5, cuts: [{ from: 1.01, to: 2.02 }], fps: 30, padding: 0 });
  assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 1], [2.033, 5]]);
  for (const s of segs) {
    assert.ok(Math.abs(s.start * 30 - Math.round(s.start * 30)) < 0.05);
    assert.ok(Math.abs(s.end * 30 - Math.round(s.end * 30)) < 0.05);
  }
});

test('drops tiny leftover blips between cuts', () => {
  const segs = keepSegments({ duration: 10, cuts: [{ from: 2, to: 5 }, { from: 5.1, to: 8 }], padding: 0 });
  assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 2], [8, 10]]);
});

test('maps source times onto the edited timeline', () => {
  const segs = keepSegments({ duration: 14, silences: [{ start: 2.6, end: 4 }], padding: 0.2 });
  assert.deepEqual(mapRange(4.2, 6.4, segs), { start: 3.2, end: 5.4 });
  // A range that spans a cut is squeezed together.
  assert.deepEqual(mapRange(2, 5, segs), { start: 2, end: 4 });
  // A range entirely inside a cut disappears.
  assert.equal(mapRange(3, 3.5, segs), null);
});
