import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepGraph, mixGraph, parseLoudnorm } from '../src/ffmpeg.js';
import { defaultProject, timeline } from '../src/project.js';

test('prep graph trims and concatenates every kept segment', () => {
  const graph = prepGraph({
    segments: [
      { start: 0, end: 2.8 },
      { start: 3.8, end: 14 },
    ],
    width: 1920,
    height: 1080,
    fps: 30,
    audioInput: '0:a:0',
  });
  assert.match(graph, /split=2\[v0\]\[v1\]/);
  // Cuts sit exactly on frame boundaries so video and audio pieces match exactly.
  assert.match(graph, /\[v0\]trim=start=0:end=2\.8,/);
  assert.match(graph, /\[v1\]trim=start=3\.8:end=14,/);
  assert.match(graph, /\[a1\]atrim=start=3\.8:end=14,/);
  assert.match(graph, /\[sv0\]\[sa0\]\[sv1\]\[sa1\]concat=n=2:v=1:a=1\[vout\]\[acat\]/);
  assert.match(graph, /loudnorm=I=-16/);
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
