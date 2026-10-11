// `node vedit.js demo` — makes fake footage, music and a sound effect with
// FFmpeg, then runs the whole pipeline. Proves the setup works end to end
// without needing a Tella recording or Epidemic Sound track yet.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UserError, log, run } from './util.js';
import { createProject, loadProject, saveProject, paths } from './project.js';
import { cmdAll } from './commands.js';

const NAME = 'demo';

export async function cmdDemo(_args, opts) {
  const p = paths(NAME);
  if (existsSync(p.file)) {
    const existing = JSON.parse(readFileSync(p.file, 'utf8'));
    if (!existing._demo) throw new UserError('A project called "demo" already exists and was not made by this command. Rename it first.');
    rmSync(p.dir, { recursive: true, force: true });
  }

  log.step('Creating demo project with generated test media');
  createProject(NAME, { title: 'My First Edit' });
  const ff = (args) => run('ffmpeg', ['-hide_banner', '-y', '-loglevel', 'error', ...args]);

  // 14 s "recording": test pattern + a tone that talks for 2.6 s then pauses for 1.4 s.
  await ff([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-f', 'lavfi', '-i', "sine=frequency=220:sample_rate=48000,volume='if(lt(mod(t,4),2.6),0.4,0)':eval=frame",
    '-t', '14', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    join(p.raw, 'recording.mp4'),
  ]);
  // A short chord as stand-in "music" (loops automatically to fill the video).
  await ff([
    '-f', 'lavfi', '-i',
    "aevalsrc='0.15*sin(2*PI*261.63*t)+0.15*sin(2*PI*329.63*t)+0.15*sin(2*PI*392*t)':s=48000:c=stereo",
    '-t', '8', join(p.music, 'demo-music.wav'),
  ]);
  // A "whoosh" for the cut from intro to footage.
  await ff([
    '-f', 'lavfi', '-i', 'anoisesrc=d=0.6:c=pink:a=0.6:r=48000',
    '-af', 'lowpass=f=2500,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.3',
    join(p.sfx, 'whoosh.wav'),
  ]);
  // A placeholder logo for the intro and outro cards.
  await ff([
    '-f', 'lavfi', '-i', 'color=c=0xff5a36:s=200x200',
    '-vf', "drawbox=x=50:y=50:w=100:h=100:color=white:t=fill",
    '-frames:v', '1', join(p.assets, 'logo.png'),
  ]);
  // Subtitles timed against the original recording; they get shifted to match the cuts.
  writeFileSync(
    join(p.dir, 'captions.srt'),
    ['1', '00:00:00,200 --> 00:00:02,400', 'Captions follow the edit,', '',
      '2', '00:00:04,200 --> 00:00:06,400', 'even after pauses are cut.', '',
      '3', '00:00:08,200 --> 00:00:10,400', 'Swap in your own recording next.', ''].join('\n'),
  );

  const project = loadProject(NAME);
  Object.assign(project, {
    _demo: true,
    subtitle: 'Tella · FFmpeg · HyperFrames · Epidemic Sound',
    brand: { ...project.brand, logo: 'assets/logo.png' },
    source: { file: 'raw/recording.mp4', tellaVideoId: null },
    lowerThird: { ...project.lowerThird, name: 'Your Name', role: 'Demo project' },
    captions: { enabled: true, file: 'captions.srt', timing: 'source' },
    music: {
      file: 'music/demo-music.wav', volumeDb: -10, duck: true, fadeIn: 1, fadeOut: 3,
      credit: { source: 'Generated test tone', title: 'Demo chord' },
    },
    sfx: [{ file: 'sfx/whoosh.wav', at: 'main-0.3', volumeDb: -6 }],
    exports: ['landscape', 'vertical'],
  });
  saveProject(project);
  log.ok(`Demo project at ${p.dir}`);

  await cmdAll([NAME], opts);

  log.step('Demo finished');
  log.info(`Open the results in ${p.exports}`);
  log.info('If they look and sound right, your setup works. Now make a real one:');
  log.info('  node vedit.js new my-first-video');
}
