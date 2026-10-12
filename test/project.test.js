import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectName, findVideos } from '../src/project.js';
import { PROJECTS_DIR } from '../src/util.js';

test('project folder names can have spaces and numbers', () => {
  assert.equal(projectName('My top 3 mistakes in the 1st 6 months of my startup'), 'My top 3 mistakes in the 1st 6 months of my startup');
  assert.equal(projectName('my-video_2'), 'my-video_2');
});

test('a path to a folder inside projects/ is accepted too', () => {
  assert.equal(projectName(join(PROJECTS_DIR, 'My video')), 'My video');
  assert.equal(projectName(join(PROJECTS_DIR, 'My video') + '/'), 'My video');
});

test('rejects names that could escape the projects folder or that Windows forbids', () => {
  for (const bad of ['../etc', 'a/b', '.hidden', 'what?', 'a:b', 'trailing.', 'trailing ', '', '   ']) {
    assert.throws(() => projectName(bad), undefined, JSON.stringify(bad));
  }
  assert.throws(() => projectName(join(tmpdir(), 'elsewhere')));
});

test('finds videos at the top of a project folder and in raw/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vedit-proj-'));
  mkdirSync(join(dir, 'raw'));
  mkdirSync(join(dir, 'exports'));
  writeFileSync(join(dir, 'Recording 1.MP4'), '');
  writeFileSync(join(dir, 'notes.txt'), '');
  writeFileSync(join(dir, 'raw', 'b.mov'), '');
  writeFileSync(join(dir, 'exports', 'old - cut.mp4'), '');
  assert.deepEqual(findVideos(dir), ['Recording 1.MP4', 'raw/b.mov']);
});
