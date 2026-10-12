import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editGraph, mixGraph, parseLoudnorm, pickFrameRate } from '../src/ffmpeg.js';
import { defaultProject, timeline } from '../src/project.js';

test('full-pipeline edit graph conforms the picture, joins segments and cleans the voice', () => {
  const graph = editGraph({
    segments: [
      { start: 0, end: 2.8 },
      { start: 3.8, end: 14 },
    ],
    fps: '30',
    audioInput: '0:a:0',
    scale: { width: 1920, height: 1080 },
    cleanVoice: true,
  });
  assert.match(graph, /\[0:v\]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=/);
  assert.match(graph, /split=2\[v0\]\[v1\]/);
  // Cuts sit exactly on frame boundaries so video and audio pieces match exactly.
  assert.match(graph, /\[v0\]trim=start=0:end=2\.8,/);
  assert.match(graph, /\[v1\]trim=start=3\.8:end=14,/);
  assert.match(graph, /\[a1\]atrim=start=3\.8:end=14,/);
  assert.match(graph, /\[sv0\]\[sa0\]\[sv1\]\[sa1\]concat=n=2:v=1:a=1\[vout\]\[acat\]/);
  assert.match(graph, /loudnorm=I=-16/);
});

test('cut-only graph keeps the original size, frame rate and sound', () => {
  const graph = editGraph({
    segments: [
      { start: 0, end: 1.001 },
      { start: 2.002, end: 5 },
    ],
    fps: '30000/1001',
    audioInput: '0:a:0',
  });
  assert.match(graph, /\[0:v\]fps=30000\/1001,scale=trunc\(iw\/2\)\*2:trunc\(ih\/2\)\*2,format=yuv420p,split=2/);
  assert.doesNotMatch(graph, /pad=|loudnorm|acompressor|aresample/);
  assert.match(graph, /\[0:a:0\]asplit=2\[a0\]\[a1\]/);
  // 1.001 s is exactly frame 30 at 29.97 fps.
  assert.match(graph, /\[v0\]trim=start=0:end=1\.001,/);
  assert.match(graph, /\[acat\]anull\[aout\]$/);
});

test('edits at the recording\'s own frame rate, snapped to a standard one', () => {
  assert.equal(pickFrameRate('30/1').expr, '30');
  assert.equal(pickFrameRate('30000/1001').expr, '30000/1001');
  assert.equal(pickFrameRate('2987/100').expr, '30000/1001'); // phone variable frame rate
  assert.equal(pickFrameRate('5994/100').expr, '60000/1001');
  assert.equal(pickFrameRate('0/0', '25/1').expr, '25');
  assert.equal(pickFrameRate('14/1').expr, '14');
  assert.equal(pickFrameRate(undefined).expr, '30');
});

test('mix graph ducks music under the voice and places sound effects', () => {
  const project = defaultProject('t');
  project.music = { file: 'music/x.mp3', volumeDb: -12, duck: true, fadeIn: 1, fadeOut: 3 };
  const sfx = { file: 'sfx/w.wav', at: 'main-0.3', volumeDb: -6 };
  const tl = timeline(project, 60);
  const graph = mixGraph({ project, tl, musicInput: 2, sfxInputs: [{ input: 3, sfx }] });
  assert.match(graph, /adelay=3000:all=1/); // voice starts after the 3 s intro
  assert.match(graph, /asplit=2\[voice\]\[sidechain\]/);
  assert.match(graph, /volume=-12dB/);
  assert.match(graph, /afade=t=out:st=64:d=3/);
  assert.match(graph, /\[bed\]\[sidechain\]sidechaincompress/);
  assert.match(graph, /adelay=2700:all=1\[sfx0\]/);
  assert.match(graph, /\[voice\]\[music\]\[sfx0\]amix=inputs=3/);
  assert.match(graph, /\[mix\]$/);
});

test('mix graph without music or effects is just the voice', () => {
  const project = defaultProject('t');
  const graph = mixGraph({ project, tl: timeline(project, 10), musicInput: null, sfxInputs: [] });
  assert.doesNotMatch(graph, /sidechain/);
  assert.match(graph, /\[voice\]anull\[mix\]/);
});

test('music can be left un-ducked', () => {
  const project = defaultProject('t');
  project.music = { file: 'm.mp3', duck: false };
  const graph = mixGraph({ project, tl: timeline(project, 10), musicInput: 2, sfxInputs: [] });
  assert.doesNotMatch(graph, /sidechaincompress/);
  assert.match(graph, /\[voice\]\[music\]amix/);
});

test('reads the loudnorm measurement block', () => {
  const stderr = `lots of log\n[Parsed_loudnorm_9 @ 0x1]\n{\n\t"input_i" : "-17.29",\n\t"input_tp" : "-3.10",\n\t"input_lra" : "5.00",\n\t"input_thresh" : "-27.5",\n\t"target_offset" : "0.2"\n}\n`;
  assert.deepEqual(parseLoudnorm(stderr), {
    input_i: '-17.29',
    input_tp: '-3.10',
    input_lra: '5.00',
    input_thresh: '-27.5',
    target_offset: '0.2',
  });
});
