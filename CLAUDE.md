# Working in this repo

A video editing pipeline driven by `node vedit.js <command>`:
Tella (recording) → FFmpeg (`prep`: cuts, conform, voice clean-up) → HyperFrames
(`build`: HTML/GSAP composition with titles, name tag, captions, outro) → `render`
(HyperFrames renders the picture; FFmpeg mixes voice + Epidemic Sound music/SFX,
masters to -14 LUFS, makes vertical/square exports).

- User guide: `docs/SETUP.md`. Command list: `node vedit.js help`.
- Each video is `projects/<name>/project.json` plus media folders. `projects/` is
  git-ignored: never commit footage, music or renders (Epidemic Sound files are licensed).
- After code changes run `npm test`; for pipeline changes also run `node vedit.js demo`
  and look at `projects/demo/exports/`.
- Code style: Node 22 ESM, no build step, minimal dependencies (only `hyperframes` and `gsap`).
  Pure logic (segments, captions, filter graphs, composition HTML) is kept in testable
  functions; side effects live in `src/commands.js`.

## Adding music with the Epidemic Sound connector

When the user asks for music for a project:

1. `node vedit.js info <project> --json` and read `timeline.total` (seconds) for the
   video length. If footage isn't prepped yet, run `node vedit.js prep <project>` first.
2. `SearchRecordings` with a `term` (or mood/genre filters, `vocals: false` for talking-head
   videos). The vocals filter is loose, so also check the `vocal type` tag ("no vocals" vs
   "vocal presence"). Show the user 3–5 options: title, artist (MAIN_ARTIST credit), BPM,
   length, and the `audioFile.lqmp3Url` preview link. Let them pick.
3. If the track is far from the video length and the video is under 5 minutes, offer an
   edit: `EditRecording` with `targetDurationMs = round(timeline.total * 1000)` (max 300000),
   `downloadAudioFormat: "MP3"`, then `PollEditRecordingJob` until COMPLETED and
   `DownloadRecordingEdit`. Otherwise `DownloadRecording` with `fileType: "MP3"`,
   `stemType: "FULL"` (longer videos simply loop the track).
4. Add it with the signed `assetUrl` (quote it, it contains `&`):
   `node vedit.js music add <project> "<assetUrl>" --title "<title>" --artist "<artist>" --id <recording-id> --ext mp3`
   Signed URLs expire, so run this right after downloading.

Sound effects work the same way: `SearchSoundEffects` → `DownloadSoundEffect` →
`node vedit.js sfx add <project> "<assetUrl>" --at <time> --title "<title>" --id <id> --ext mp3`.
`--at` takes seconds or `start|main|outro|end` with an offset (`main-0.3` = just before
the footage starts).

## Tella

`node vedit.js tella list` / `tella pull <project> <video-id>` use `TELLA_API_KEY` from `.env`.
If the Tella connector is connected in Claude, it can be used to look up video IDs; the
download itself still goes through `vedit tella pull` so the file lands in the project.

## HyperFrames

The composition is generated into `projects/<name>/build/` and overwritten on every
`build`: `index.html` holds the footage, preview audio and where each graphic sits; each
graphic (intro, lower-third, captions, outro) is a sub-composition in `compositions/` with
its own GSAP timeline in local time. Change the look via `templates/theme.css` (or a
per-project `assets/theme.css`) and structure via `src/compose.js`. Lint with
`npx hyperframes lint projects/<name>/build`. For bespoke graphics, the HyperFrames skills
can be installed with `npx hyperframes skills update`.
