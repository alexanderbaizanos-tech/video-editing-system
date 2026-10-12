# video-editing-system

Turn a raw **Tella** recording into a finished, upload-ready video with one command line tool.

| Tool | What it does here |
| ---- | ----------------- |
| [Tella](https://www.tella.com) | You record screen + camera. The tool exports and downloads it through the Tella API. |
| [FFmpeg](https://ffmpeg.org) | Cuts long pauses and any cuts you list, conforms size and frame rate, cleans up your voice, mixes music under your voice, masters loudness to -14 LUFS, makes vertical/square versions. |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | Draws the graphics as an HTML + GSAP composition: title card, name tag, captions, end card. Renders them with your footage. |
| [Epidemic Sound](https://www.epidemicsound.com) | Music and sound effects, added through Claude's Epidemic Sound connector or downloaded by hand. Credits are written for you. |

```
Tella recording ─▶ FFmpeg clean-up ─▶ HyperFrames graphics ─▶ FFmpeg music mix + master ─▶ MP4s
```

## Quick start

You need Node.js 22+ and FFmpeg installed. **[docs/SETUP.md](docs/SETUP.md) walks through everything step by step**, including installing those.

```bash
npm install
npx hyperframes browser ensure     # Chrome for rendering, one time
node vedit.js doctor               # checks your setup
node vedit.js demo                 # full test run with generated media
```

Only want the pauses cut out? Put the video in a folder inside `projects/` and run:

```bash
node vedit.js cut "My video folder"      # → projects/My video folder/exports/My video folder - cut.mp4
```

For the full treatment (titles, music, exports) on a real video:

```bash
node vedit.js new my-video --title "How I Plan My Week"
node vedit.js tella pull my-video <tella-video-id>      # or: node vedit.js import my-video recording.mp4
node vedit.js music add my-video track.mp3 --title "Track" --artist "Artist"
node vedit.js all my-video                              # prep + build + render
```

Results land in `projects/my-video/exports/`.

## What you get

- Long pauses cut automatically, frame-accurate, with picture and sound kept in sync; the pause level adapts to your room noise and mic
- A `cut` command that does only that, keeping the recording's own size, frame rate and sound
- Voice clean-up: rumble filter, gentle compression, level matching
- Title card, animated name tag, optional captions (from an `.srt`/`.vtt` file or automatic transcription), end card with call to action
- Music that dips while you talk and fades in and out, plus sound effects at the times you choose
- Loudness mastered to -14 LUFS (two-pass), the level YouTube and most platforms expect
- Landscape, vertical (9:16) and square versions, a thumbnail frame, and a `CREDITS.txt`

## Layout

```
vedit.js            the command-line tool (run `node vedit.js help`)
src/                pipeline code: Tella client, FFmpeg steps, HyperFrames composition
templates/theme.css look of the graphics (copy into a project's assets/ to customise)
test/               unit tests: npm test
docs/SETUP.md       step-by-step setup and usage guide
projects/<name>/    one folder per video (not committed: footage and licensed music)
  project.json      that video's settings
  raw/ music/ sfx/ assets/
  build/            generated files (prepped footage, HyperFrames composition)
  exports/          finished videos
```

## Development

```bash
npm test            # unit tests (no FFmpeg needed)
node vedit.js demo  # end-to-end check (needs FFmpeg + the HyperFrames browser)
```
