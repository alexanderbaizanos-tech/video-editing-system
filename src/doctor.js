import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, run, hyperframes, hyperframesBin, gsapFile } from './util.js';
import { TellaClient } from './tella.js';

const INSTALL = {
  node: {
    darwin: 'brew install node   (or the LTS installer from https://nodejs.org)',
    win32: 'winget install OpenJS.NodeJS.LTS   (or the LTS installer from https://nodejs.org)',
    linux: 'Use the LTS installer or nvm: https://nodejs.org/en/download',
  },
  ffmpeg: {
    darwin: 'brew install ffmpeg',
    win32: 'winget install Gyan.FFmpeg   (then open a new terminal)',
    linux: 'sudo apt install ffmpeg   (or your distro\'s package manager)',
  },
};

const hint = (what) => INSTALL[what][process.platform] ?? INSTALL[what].linux;

export async function cmdDoctor() {
  let failures = 0;
  const pass = (label, detail) => console.log(`  ✓ ${label.padEnd(18)} ${detail}`);
  const fail = (label, detail, fix) => {
    failures++;
    console.log(`  ✗ ${label.padEnd(18)} ${detail}`);
    if (fix) console.log(`    ${''.padEnd(18)} fix: ${fix}`);
  };
  const warn = (label, detail, fix) => {
    console.log(`  ! ${label.padEnd(18)} ${detail}`);
    if (fix) console.log(`    ${''.padEnd(18)} ${fix}`);
  };

  console.log('\nChecking your video editing setup…\n');

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) pass('Node.js', `v${process.versions.node}`);
  else fail('Node.js', `v${process.versions.node} is too old (need 22 or newer)`, hint('node'));

  for (const tool of ['ffmpeg', 'ffprobe']) {
    try {
      const { stdout } = await run(tool, ['-hide_banner', '-version']);
      pass(tool === 'ffmpeg' ? 'FFmpeg' : 'FFprobe', stdout.split('\n')[0].replace(/ Copyright.*/, ''));
    } catch {
      fail(tool === 'ffmpeg' ? 'FFmpeg' : 'FFprobe', 'not found on PATH', hint('ffmpeg'));
    }
  }

  try {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-filters']);
    const missing = ['astats', 'ametadata', 'loudnorm', 'sidechaincompress', 'amix', 'boxblur'].filter(
      (f) => !new RegExp(`\\s${f}\\s`).test(stdout),
    );
    const { stdout: enc } = await run('ffmpeg', ['-hide_banner', '-encoders']);
    if (!/libx264/.test(enc)) missing.push('libx264 encoder');
    if (missing.length) fail('FFmpeg features', `missing: ${missing.join(', ')}`, `install a full FFmpeg build: ${hint('ffmpeg')}`);
    else pass('FFmpeg features', 'pause detection, loudness, ducking, H.264');
  } catch {
    /* already reported above */
  }

  const installed = existsSync(join(ROOT, 'node_modules'));
  try {
    hyperframesBin();
    gsapFile();
    const { stdout } = await hyperframes(['--version'], { allowFail: true });
    pass('HyperFrames', (stdout.trim().split('\n').pop() || 'installed').replace(/\x1b\[[0-9;]*m/g, ''));
  } catch {
    fail('HyperFrames', installed ? 'package missing' : 'npm packages not installed', 'npm install');
  }

  try {
    const { code, stdout } = await hyperframes(['browser', 'path'], { allowFail: true });
    if (code === 0 && stdout.trim()) pass('Render browser', 'Chrome headless shell found');
    else fail('Render browser', 'HyperFrames needs its own Chrome to render', 'npx hyperframes browser ensure');
  } catch {
    /* HyperFrames missing, reported above */
  }

  if (process.env.TELLA_API_KEY) {
    try {
      await new TellaClient().listVideos({ limit: 1 });
      pass('Tella API', 'key works');
    } catch (err) {
      fail('Tella API', err.message.split('\n')[0], 'check TELLA_API_KEY in .env');
    }
  } else {
    warn('Tella API', 'no TELLA_API_KEY in .env (optional)', 'without it, download recordings from Tella and use `node vedit.js import`');
  }

  warn('Epidemic Sound', 'nothing to check locally', 'get tracks via the Epidemic Sound connector in Claude, or download from epidemicsound.com');

  console.log(failures ? `\n${failures} problem(s) to fix — see the "fix:" lines above.\n` : '\nAll set. Try: node vedit.js demo\n');
  return failures === 0;
}
