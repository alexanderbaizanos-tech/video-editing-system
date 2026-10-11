import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECTS_DIR = join(ROOT, 'projects');
export const TEMPLATES_DIR = join(ROOT, 'templates');

export class UserError extends Error {}

export const log = {
  step: (msg) => console.log(`\n▶ ${msg}`),
  info: (msg) => console.log(`  ${msg}`),
  ok: (msg) => console.log(`  ✓ ${msg}`),
  warn: (msg) => console.log(`  ! ${msg}`),
};

/** Load KEY=value pairs from .env into process.env (existing env vars win). */
export function loadEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const BOOLEAN_FLAGS = new Set(['draft', 'force', 'help', 'json', 'no-exports']);

/**
 * Minimal argument parser. Unlike node:util parseArgs it accepts negative
 * numbers as option values (`--volume -6`), which the sfx/music commands need.
 */
export function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      options[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i++;
    }
  }
  return { positionals, options };
}

/**
 * Run a command. Resolves with { code, stdout, stderr }; rejects on non-zero
 * exit unless `allowFail` is set. With `inherit`, output streams to the terminal.
 */
export function run(cmd, args, { inherit = false, allowFail = false, cwd, env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new UserError(`"${cmd}" was not found. Run \`node vedit.js doctor\` for install help.`));
      else reject(err);
    });
    child.on('close', (code) => {
      if (code !== 0 && !allowFail) {
        const tail = stderr.trim().split('\n').slice(-15).join('\n');
        reject(new UserError(`${cmd} exited with code ${code}${tail ? `:\n${tail}` : ''}`));
      } else {
        resolvePromise({ code, stdout, stderr });
      }
    });
  });
}

const require = createRequire(import.meta.url);

/** Absolute path to the HyperFrames CLI entry point installed in node_modules. */
export function hyperframesBin() {
  try {
    const pkgPath = require.resolve('hyperframes/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.hyperframes;
    return join(dirname(pkgPath), bin);
  } catch {
    throw new UserError('HyperFrames is not installed. Run `npm install` in the project folder.');
  }
}

/** Run the locally installed HyperFrames CLI through the current Node binary (works on Windows too). */
export function hyperframes(args, opts) {
  return run(process.execPath, [hyperframesBin(), ...args], opts);
}

export function gsapFile() {
  try {
    return join(dirname(require.resolve('gsap/package.json')), 'dist', 'gsap.min.js');
  } catch {
    throw new UserError('GSAP is not installed. Run `npm install` in the project folder.');
  }
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function round(n, digits = 3) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** "93.5" -> "1:33.5" for human-readable durations. */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Stream a URL to disk (via a .part file, so an interrupted download never looks finished). */
export async function downloadFile(url, dest, { fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
  const res = await fetchImpl(url);
  if (!res.ok || !res.body) throw new UserError(`Download failed (HTTP ${res.status}). Signed links expire after a while; fetch a fresh one.`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const tmp = `${dest}.part`;
  await pipeline(
    Readable.fromWeb(res.body),
    async function* (source) {
      for await (const chunk of source) {
        received += chunk.length;
        onProgress(received, total);
        yield chunk;
      }
    },
    createWriteStream(tmp),
  );
  renameSync(tmp, dest);
  return dest;
}
