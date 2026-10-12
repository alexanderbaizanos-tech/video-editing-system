import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, quoteArg } from '../src/util.js';

test('parses positionals, options and negative numbers', () => {
  const { positionals, options } = parseArgs(['add', 'my-video', 'https://x/y.mp3', '--volume', '-6', '--title', 'Song', '--draft']);
  assert.deepEqual(positionals, ['add', 'my-video', 'https://x/y.mp3']);
  assert.deepEqual(options, { volume: '-6', title: 'Song', draft: true });
});

test('supports --key=value and boolean flags before positionals', () => {
  const { positionals, options } = parseArgs(['--draft', 'my-video', '--at=main-0.3']);
  assert.deepEqual(positionals, ['my-video']);
  assert.deepEqual(options, { draft: true, at: 'main-0.3' });
});

test('quotes names with spaces for copy-paste commands', () => {
  assert.equal(quoteArg('my-video'), 'my-video');
  assert.equal(quoteArg('My top 3 mistakes'), '"My top 3 mistakes"');
});
