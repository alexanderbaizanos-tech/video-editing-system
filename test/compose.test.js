import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compositionFiles } from '../src/compose.js';
import { defaultProject, timeline, resolveTime } from '../src/project.js';

const attr = (html, id, name) => html.match(new RegExp(`id="${id}"[^>]*?${name}="([^"]+)"`))?.[1];

test('lays out intro, footage and outro back to back', () => {
  const project = defaultProject('t', 'Title');
  const files = compositionFiles({ project, tl: timeline(project, 60) });
  const html = files['index.html'];
  assert.equal(attr(html, 'root', 'data-duration'), '67');
  assert.equal(attr(html, 'intro-layer', 'data-duration'), '3');
  assert.equal(attr(html, 'main-video', 'data-start'), '3');
  assert.equal(attr(html, 'main-video', 'data-duration'), '60');
  assert.equal(attr(html, 'outro-layer', 'data-start'), '63');
  assert.equal(attr(html, 'lower-third-layer', 'data-start'), '4');
  assert.equal(attr(html, 'intro-layer', 'data-composition-src'), 'compositions/intro.html');
  assert.match(html, /window\.__timelines\["main"\] = tl/);
  assert.deepEqual(Object.keys(files).sort(), ['compositions/intro.html', 'compositions/lower-third.html', 'compositions/outro.html', 'index.html']);
});

test('each graphic is a sub-composition with its own timeline in local time', () => {
  const project = defaultProject('t', 'Title');
  const files = compositionFiles({ project, tl: timeline(project, 60) });
  const lt = files['compositions/lower-third.html'];
  assert.match(lt, /^<!--[^]*<template id="lower-third-template">/);
  assert.match(lt, /data-composition-id="lower-third"[^>]*data-duration="5"/);
  assert.match(lt, /window\.__timelines\["lower-third"\] = tl/);
  // Slide-out starts 0.4 s before the end of the 5 s graphic, in local time.
  assert.match(lt, /\{ x: -40, opacity: 0, duration: 0\.4, ease: "power2\.in" \}, 4\.6\)/);
});

test('turning graphics off leaves just the footage', () => {
  const project = defaultProject('t');
  project.intro.enabled = false;
  project.outro.enabled = false;
  project.lowerThird.enabled = false;
  const files = compositionFiles({ project, tl: timeline(project, 10) });
  assert.deepEqual(Object.keys(files), ['index.html']);
  assert.equal(attr(files['index.html'], 'main-video', 'data-start'), '0');
});

test('escapes text so titles cannot break the page', () => {
  const project = defaultProject('t', 'Tips & <Tricks> "quoted"');
  const intro = compositionFiles({ project, tl: timeline(project, 10) })['compositions/intro.html'];
  assert.match(intro, /Tips &amp; &lt;Tricks&gt; &quot;quoted&quot;/);
  assert.doesNotMatch(intro, /<Tricks>/);
});

test('graphics find the logo one folder up', () => {
  const project = defaultProject('t');
  const files = compositionFiles({ project, tl: timeline(project, 10), logo: 'logo.png' });
  assert.match(files['compositions/intro.html'], /<img class="logo" src="\.\.\/logo\.png"/);
  assert.match(files['compositions/outro.html'], /<img class="logo" src="\.\.\/logo\.png"/);
});

test('captions run alongside the footage and switch on and off in footage time', () => {
  const project = defaultProject('t');
  const files = compositionFiles({
    project,
    tl: timeline(project, 10),
    captions: [
      { start: 1, end: 2.5, text: 'Hi' },
      { start: 9.5, end: 12, text: 'runs past the end' },
    ],
  });
  assert.equal(attr(files['index.html'], 'captions-layer', 'data-start'), '3');
  assert.equal(attr(files['index.html'], 'captions-layer', 'data-duration'), '10');
  assert.match(files['index.html'], /class="has-captions"/);
  const caps = files['compositions/captions.html'];
  assert.match(caps, /tl\.set\("#cap-0", \{ autoAlpha: 1 \}, 1\);/);
  assert.match(caps, /tl\.set\("#cap-0", \{ autoAlpha: 0 \}, 2\.5\);/);
  assert.match(caps, /tl\.set\("#cap-1", \{ autoAlpha: 0 \}, 10\);/); // clipped to the footage
});

test('resolves sound-effect cue times against the timeline', () => {
  const tl = timeline(defaultProject('t'), 60); // main at 3, outro at 63, end at 67
  assert.equal(resolveTime(12.5, tl), 12.5);
  assert.equal(resolveTime('12.5', tl), 12.5);
  assert.equal(resolveTime('main-0.3', tl), 2.7);
  assert.equal(resolveTime('outro', tl), 63);
  assert.equal(resolveTime('end - 2', tl), 65);
  assert.throws(() => resolveTime('sometime', tl));
});
