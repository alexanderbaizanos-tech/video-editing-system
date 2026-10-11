// Tella public API client: list recordings, export one, download the file.
// Docs: https://www.tella.com/docs (base URL https://api.tella.com/v1, Bearer API key).
import { UserError, downloadFile } from './util.js';

const BASE_URL = 'https://api.tella.com/v1';
const DONE = new Set(['ready', 'completed', 'complete', 'done', 'succeeded', 'success', 'finished']);
const FAILED = new Set(['failed', 'error', 'errored', 'cancelled', 'canceled']);

export class TellaClient {
  constructor({ apiKey = process.env.TELLA_API_KEY, fetchImpl = globalThis.fetch, sleep = defaultSleep } = {}) {
    if (!apiKey) {
      throw new UserError(
        'TELLA_API_KEY is not set. Add it to the .env file (see docs/SETUP.md, step 4), ' +
          'or download the video from Tella yourself and run `node vedit.js import <project> <file>`.',
      );
    }
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.sleep = sleep;
  }

  async request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      // The API allows 100 requests/minute; back off politely when we hit it.
      if (res.status === 429 && attempt < 5) {
        const wait = Number(res.headers.get('retry-after')) || 2 ** attempt * 2;
        await this.sleep(wait * 1000);
        continue;
      }
      const text = await res.text();
      const data = text ? safeJson(text) : {};
      if (!res.ok) {
        const msg = data?.error?.message || data?.message || data?.error || text || res.statusText;
        if (res.status === 401) throw new UserError('Tella rejected the API key (401). Check TELLA_API_KEY in .env.');
        if (res.status === 403) throw new UserError(`Tella says you don't have access (403): ${msg}. Downloads may be disabled for this video.`);
        if (res.status === 404) throw new UserError(`Tella could not find that (404): ${path}`);
        throw new UserError(`Tella API ${method} ${path} failed (${res.status}): ${msg}`);
      }
      return data;
    }
  }

  async listVideos({ limit = 20 } = {}) {
    const videos = [];
    let cursor = null;
    do {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const page = await this.request('GET', `/videos${qs}`);
      videos.push(...(page.videos ?? page.data ?? []));
      cursor = page.pagination?.hasMore ? page.pagination.nextCursor : null;
    } while (cursor && videos.length < limit);
    return videos.slice(0, limit);
  }

  async getVideo(id) {
    const data = await this.request('GET', `/videos/${encodeURIComponent(id)}`);
    return data.video ?? data;
  }

  startExport(videoId, options = {}) {
    return this.request('POST', `/videos/${encodeURIComponent(videoId)}/exports`, options);
  }

  getExport(videoId, exportId) {
    // Export IDs can contain slashes, so they must be encoded as one path segment.
    return this.request('GET', `/videos/${encodeURIComponent(videoId)}/exports/${encodeURIComponent(exportId)}`);
  }

  /** Start an export and poll until Tella has a download link for it. */
  async exportAndWait(videoId, { options = { granularity: 'video' }, intervalMs = 5000, timeoutMs = 30 * 60 * 1000, onStatus = () => {} } = {}) {
    const started = readExport(await this.startExport(videoId, options));
    if (started.downloadUrl) return started;
    if (!started.id) throw new UserError('Tella did not return an export ID. Try exporting from the Tella app instead.');

    const deadline = Date.now() + timeoutMs;
    let last = started;
    while (Date.now() < deadline) {
      await this.sleep(intervalMs);
      last = readExport(await this.getExport(videoId, started.id));
      onStatus(last);
      if (last.downloadUrl && (!last.status || DONE.has(last.status))) return last;
      if (FAILED.has(last.status)) throw new UserError(`Tella export failed (status: ${last.status}).`);
    }
    throw new UserError(`Timed out waiting for Tella export ${started.id} (last status: ${last.status ?? 'unknown'}).`);
  }

  /** Signed download links don't take our API key, so this is a plain GET. */
  download(url, dest, opts = {}) {
    return downloadFile(url, dest, { ...opts, fetchImpl: this.fetch });
  }
}

/**
 * Pull id / status / download URL / progress out of an export response.
 * Accepts the export object directly or wrapped as { export: {...} } / { data: {...} }.
 */
export function readExport(payload) {
  const e = payload?.export ?? payload?.data ?? payload ?? {};
  const files = e.files ?? e.downloads ?? [];
  return {
    id: e.id ?? e.exportId ?? null,
    status: (e.status ?? e.state ?? '').toString().toLowerCase() || null,
    progress: e.progress ?? e.percent ?? null,
    downloadUrl: e.downloadUrl ?? e.download_url ?? e.url ?? files[0]?.downloadUrl ?? files[0]?.url ?? null,
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
