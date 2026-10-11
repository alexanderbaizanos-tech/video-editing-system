import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TellaClient, readExport } from '../src/tella.js';

/** Fake fetch that replays canned responses and records every request. */
function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    const { status = 200, json, body, headers = {} } = typeof next === 'function' ? next(url) : next;
    return new Response(body ?? (json === undefined ? '' : JSON.stringify(json)), { status, headers });
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {};

test('requires an API key', () => {
  assert.throws(() => new TellaClient({ apiKey: '' }), /TELLA_API_KEY/);
});

test('lists videos across pages with the bearer key', async () => {
  const { fetchImpl, calls } = fakeFetch([
    { json: { videos: [{ id: 'a', name: 'One' }], pagination: { hasMore: true, nextCursor: 'c/2' } } },
    { json: { videos: [{ id: 'b', name: 'Two' }], pagination: { hasMore: false } } },
  ]);
  const client = new TellaClient({ apiKey: 'tella_pk_x', fetchImpl, sleep: noSleep });
  const videos = await client.listVideos({ limit: 10 });
  assert.deepEqual(videos.map((v) => v.id), ['a', 'b']);
  assert.equal(calls[0].url, 'https://api.tella.com/v1/videos');
  assert.equal(calls[1].url, 'https://api.tella.com/v1/videos?cursor=c%2F2');
  assert.equal(calls[0].headers.Authorization, 'Bearer tella_pk_x');
});

test('starts an export, polls until ready, and encodes export IDs with slashes', async () => {
  const { fetchImpl, calls } = fakeFetch([
    { json: { id: 'vid_1/exp/9', status: 'processing' } },
    { json: { id: 'vid_1/exp/9', status: 'processing', progress: 40 } },
    { json: { export: { id: 'vid_1/exp/9', status: 'ready', downloadUrl: 'https://cdn.example/x.mp4' } } },
  ]);
  const client = new TellaClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  const seen = [];
  const result = await client.exportAndWait('vid_1', { onStatus: (e) => seen.push(e.status) });
  assert.equal(result.downloadUrl, 'https://cdn.example/x.mp4');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://api.tella.com/v1/videos/vid_1/exports');
  assert.deepEqual(JSON.parse(calls[0].body), { granularity: 'video' });
  assert.equal(calls[1].url, 'https://api.tella.com/v1/videos/vid_1/exports/vid_1%2Fexp%2F9');
  assert.deepEqual(seen, ['processing', 'ready']);
});

test('reports a failed export', async () => {
  const { fetchImpl } = fakeFetch([{ json: { id: 'e1', status: 'queued' } }, { json: { id: 'e1', status: 'failed' } }]);
  const client = new TellaClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  await assert.rejects(client.exportAndWait('v'), /export failed/);
});

test('backs off on rate limiting and explains auth errors', async () => {
  const slept = [];
  const { fetchImpl } = fakeFetch([
    { status: 429, headers: { 'retry-after': '3' } },
    { json: { videos: [], pagination: { hasMore: false } } },
    { status: 401, json: { error: 'bad key' } },
  ]);
  const client = new TellaClient({ apiKey: 'k', fetchImpl, sleep: async (ms) => slept.push(ms) });
  await client.listVideos();
  assert.deepEqual(slept, [3000]);
  await assert.rejects(client.listVideos(), /rejected the API key/);
});

test('downloads to disk without the API key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vedit-'));
  const { fetchImpl, calls } = fakeFetch([{ body: 'video-bytes', headers: { 'content-length': '11' } }]);
  const client = new TellaClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  const dest = join(dir, 'out.mp4');
  await client.download('https://cdn.example/x.mp4', dest);
  assert.equal(readFileSync(dest, 'utf8'), 'video-bytes');
  assert.ok(!existsSync(`${dest}.part`));
  assert.equal(calls[0].headers.Authorization, undefined);
});

test('reads export fields from the shapes the API may return', () => {
  assert.deepEqual(readExport({ id: 'x', state: 'READY', download_url: 'u' }), { id: 'x', status: 'ready', progress: null, downloadUrl: 'u' });
  assert.equal(readExport({ data: { id: 'y', files: [{ url: 'f' }] } }).downloadUrl, 'f');
});
