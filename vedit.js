#!/usr/bin/env node
// vedit — Tella recordings in, finished videos out.
// Run `node vedit.js help` for the list of commands.
import { loadEnv, parseArgs, UserError } from './src/util.js';
import {
  cmdNew, cmdImport, cmdTella, cmdMusic, cmdSfx, cmdInfo, cmdPrep, cmdBuild, cmdPreview, cmdRender, cmdAll,
} from './src/commands.js';
import { cmdDoctor } from './src/doctor.js';
import { cmdDemo } from './src/demo.js';

const HELP = `
vedit — video editing pipeline (Tella → FFmpeg → HyperFrames → Epidemic Sound)

Setup
  node vedit.js doctor                         check everything is installed
  node vedit.js demo                           run the whole pipeline on generated test media

Start a video
  node vedit.js new <project> [--title "My Video"]
  node vedit.js tella list                     show your Tella recordings
  node vedit.js tella pull <project> <id>      export + download a Tella recording
  node vedit.js import <project> <file>        or use a video file you already have

Music and sound effects (Epidemic Sound)
  node vedit.js music add <project> <file-or-url> [--title ..] [--artist ..] [--id ..] [--volume -10]
  node vedit.js sfx add <project> <file-or-url> --at <time> [--volume -6] [--title ..] [--id ..]
      <time> is seconds (12.5) or start | main | outro | end, with an offset: main-0.3

Edit and export
  node vedit.js prep <project>                 FFmpeg: conform, cut pauses, clean up voice
  node vedit.js build <project>                HyperFrames: titles, lower third, captions, outro
  node vedit.js preview <project>              open HyperFrames Studio to check it
  node vedit.js render <project> [--draft]     render, mix music, master loudness, export
  node vedit.js all <project>                  prep + build + render in one go
  node vedit.js info <project> [--json]        lengths, music, settings

Settings live in projects/<project>/project.json. See docs/SETUP.md for the full guide.
`;

const COMMANDS = {
  doctor: cmdDoctor,
  demo: cmdDemo,
  new: cmdNew,
  import: cmdImport,
  tella: cmdTella,
  music: cmdMusic,
  sfx: cmdSfx,
  info: cmdInfo,
  prep: cmdPrep,
  build: cmdBuild,
  preview: cmdPreview,
  render: cmdRender,
  all: cmdAll,
};

async function main() {
  loadEnv();
  const [command, ...rest] = process.argv.slice(2);
  const { positionals, options } = parseArgs(rest);
  if (!command || command === 'help' || options.help || !COMMANDS[command]) {
    console.log(HELP);
    if (command && command !== 'help' && !COMMANDS[command]) {
      console.error(`Unknown command "${command}"`);
      process.exitCode = 1;
    }
    return;
  }
  const ok = await COMMANDS[command](positionals, options);
  if (ok === false) process.exitCode = 1;
}

main().catch((err) => {
  if (err instanceof UserError) {
    console.error(`\n✗ ${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
