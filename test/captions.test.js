import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimestamp, parseSubtitles, remapCues, groupWords } from '../src/captions.js';

test('parses SRT and VTT timestamps', () => {
  assert.equal(parseTimestamp('01:02:03,450'), 3723.45);
  assert.equal(parseTimestamp('02:03.450'), 123.45);
  assert.equal(parseTimestamp('00:00:00.000'), 0);
});

test('parses an SRT file, joining multi-line cues and stripping tags', () => {
  const srt = '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello <i>there</i>\r\nworld\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye\r\n';
  assert.deepEqual(parseSubtitles(srt), [
    { start: 1, end: 2.5, text: 'Hello there world' },
    { start: 3, end: 4, text: 'Bye' },
  ]);
});

test('parses a WebVTT file with cue settings', () => {
  const vtt = 'WEBVTT\n\nintro\n00:01.000 --> 00:02.000 align:center\nHi\n';
  assert.deepEqual(parseSubtitles(vtt), [{ start: 1, end: 2, text: 'Hi' }]);
});

test('shifts cues to match cuts and drops cues that were cut out', () => {
  const segments = [
    { start: 0, end: 2.8, outStart: 0 },
    { start: 3.8, end: 14, outStart: 2.8 },
  ];
  const cues = [
    { start: 0.2, end: 2.4, text: 'a' },
    { start: 3.0, end: 3.5, text: 'cut' },
    { start: 4.2, end: 6.4, text: 'b' },
  ];
  assert.deepEqual(remapCues(cues, segments), [
    { start: 0.2, end: 2.4, text: 'a' },
    { start: 3.2, end: 5.4, text: 'b' },
  ]);
});

test('groups word timestamps into readable lines', () => {
  const words = 'This is a short sentence. And here is another one that keeps going for a while longer'
    .split(' ')
    .map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const lines = groupWords(words, { maxChars: 30 });
  assert.equal(lines[0].text, 'This is a short sentence.');
  for (const l of lines) assert.ok(l.text.length <= 30, l.text);
  assert.equal(lines.map((l) => l.text).join(' '), words.map((w) => w.text).join(' '));
});

test('starts a new line after a long gap in speech', () => {
  const lines = groupWords([
    { text: 'one', start: 0, end: 0.3 },
    { text: 'two', start: 2, end: 2.3 },
  ]);
  assert.equal(lines.length, 2);
});
