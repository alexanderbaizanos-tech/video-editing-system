import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevels, findPauses, keepSegments, totalDuration, mapRange, percentile, autoThreshold } from '../src/segments.js';

const LEVELS = `
[Parsed_ametadata_4 @ 0x1] frame:0    pts:0       pts_time:0
[Parsed_ametadata_4 @ 0x1] lavfi.astats.Overall.RMS_level=-15.6
[Parsed_ametadata_4 @ 0x1] frame:1    pts:800     pts_time:0.05
[Parsed_ametadata_4 @ 0x1] lavfi.astats.Overall.RMS_level=-inf
`;

test('parses loudness readings, treating digital silence as very quiet', () => {
  assert.deepEqual(parseLevels(LEVELS), [
    { t: 0, db: -15.6 },
    { t: 0.05, db: -120 },
  ]);
});

/** 50 ms windows from a list of [seconds, dB] stretches. */
function windows(stretches) {
  const out = [];
  let t = 0;
  for (const [secs, db] of stretches) {
    for (let i = 0; i < Math.round(secs / 0.05); i++, t += 0.05) out.push({ t: Math.round(t * 1000) / 1000, db });
  }
  return out;
}

test('finds pauses long enough to cut, including one at the very end', () => {
  const w = windows([[2, -18], [0.3, -50], [2, -18], [1, -50], [2, -18], [1.5, -50]]);
  const pauses = findPauses(w, { thresholdDb: -35, minSilence: 0.8, windowSec: 0.05, duration: 8.75 });
  assert.deepEqual(pauses.map((p) => [round(p.start), round(p.end)]), [[4.3, 5.3], [7.3, 8.75]]);
});

test('a real sound in the middle of a pause splits it', () => {
  const w = windows([[2, -18], [0.5, -50], [0.05, -20], [0.5, -50], [2, -18]]);
  assert.equal(findPauses(w, { thresholdDb: -35, minSilence: 0.8, windowSec: 0.05 }).length, 0);
});

const round = (n) => Math.round(n * 1000) / 1000;

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

test('percentile picks from sorted values', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 0), 1);
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([5, 1, 3, 2, 4], 100), 5);
});

/** 100 ms loudness readings: `speech` dB while talking, `noise` dB in pauses. */
function levels(speech, noise, talkingShare = 0.7, n = 600) {
  return Array.from({ length: n }, (_, i) => (i % 10 < talkingShare * 10 ? speech + (i % 3) : noise + (i % 2)));
}

test('auto threshold keeps -35 dB for a normal recording', () => {
  const r = autoThreshold(levels(-18, -60));
  assert.equal(r.thresholdDb, -35);
  assert.ok(r.clear);
});

test('auto threshold rises above a noisy room\'s background', () => {
  const r = autoThreshold(levels(-14, -32));
  assert.ok(r.thresholdDb > r.noiseDb + 6 && r.thresholdDb < r.speechDb - 6, JSON.stringify(r));
});

test('auto threshold drops for a quiet mic so speech is not cut', () => {
  const r = autoThreshold(levels(-44, -75));
  // Well under talking level (instead of -35, which would call all of it silence) yet above the noise.
  assert.ok(r.thresholdDb <= r.speechDb - 15 && r.thresholdDb > r.noiseDb + 6, JSON.stringify(r));
});

test('auto threshold treats digital silence as very quiet and flags unclear audio', () => {
  assert.equal(autoThreshold(levels(-20, -Infinity)).thresholdDb, -35);
  assert.equal(autoThreshold(levels(-20, -26)).clear, false);
  assert.equal(autoThreshold([-20, -30]).thresholdDb, -35); // too short to judge
});
