# Setup guide

This guide takes you from nothing installed to a finished video. Each step has a
check at the end, so you know it worked before moving on.

## How the system works

```
 Tella                FFmpeg                   HyperFrames                 Epidemic Sound + FFmpeg
 ─────                ──────                   ───────────                 ───────────────────────
 You record    ──▶    Cuts pauses,      ──▶    Adds title card,     ──▶    Music ducked under your
 screen + cam         fixes size/frame         name tag, captions,         voice, sound effects,
                      rate, cleans voice       outro (HTML + GSAP)         loudness mastered to -14 LUFS
                                                                            ▼
                                                     projects/<name>/exports/
                                                     <name>.mp4 (YouTube) · <name>-vertical.mp4 (Shorts/Reels)
                                                     thumbnail · CREDITS.txt
```

You drive it all with one command-line tool, `node vedit.js`, and one settings
file per video, `projects/<name>/project.json`.

---

## Before you start

You need:

- A computer running macOS, Windows 10/11 or Linux, with about 3 GB of free disk space.
- A **Tella** account (to record). Tella's API needs downloads to be allowed on the videos you pull.
- An **Epidemic Sound** subscription (for music and sound effects).
- About 20 minutes.

All the commands below go in a terminal:

- **macOS:** open the *Terminal* app.
- **Windows:** open *Windows Terminal* or *PowerShell*.
- **Linux:** your usual terminal.

---

## Step 1 — Install Node.js (version 22 or newer)

HyperFrames and this tool run on Node.js.

| System  | Command |
| ------- | ------- |
| macOS   | `brew install node` (needs [Homebrew](https://brew.sh)), or download the **LTS** installer from [nodejs.org](https://nodejs.org) |
| Windows | `winget install OpenJS.NodeJS.LTS`, or the **LTS** installer from [nodejs.org](https://nodejs.org) |
| Linux   | The LTS installer or `nvm` from [nodejs.org/en/download](https://nodejs.org/en/download) |

**Check:** close and reopen the terminal, then run

```bash
node --version
```

You should see `v22.x.x` or higher.

## Step 2 — Install FFmpeg

FFmpeg does the cutting, audio clean-up, music mixing and final encoding.

| System  | Command |
| ------- | ------- |
| macOS   | `brew install ffmpeg` |
| Windows | `winget install Gyan.FFmpeg` |
| Linux   | `sudo apt install ffmpeg` (Debian/Ubuntu) or your distro's package manager |

**Check:** close and reopen the terminal, then run

```bash
ffmpeg -version
```

The first line should start with `ffmpeg version`.

## Step 3 — Download this project and install HyperFrames

```bash
git clone https://github.com/alexanderbaizanos-tech/video-editing-system.git
cd video-editing-system
npm install
npx hyperframes browser ensure
```

- `npm install` installs HyperFrames (the video renderer) and GSAP (the animation library), pinned to tested versions.
- `npx hyperframes browser ensure` downloads the private copy of Chrome HyperFrames uses to render frames (about 115 MB, one time).

No git? On the GitHub page click **Code → Download ZIP**, unzip it, and `cd` into the folder instead of the `git clone` line.

> HyperFrames sends anonymous usage statistics by default. To turn that off: `npx hyperframes telemetry disable`.

**Check:** `npx hyperframes --version` prints a version number.

## Step 4 — Connect Tella (optional but recommended)

With an API key, the tool can export and download your Tella recordings for you.

1. In Tella, open **Settings → API Keys** and click **Create key**. Copy it straight away; Tella shows it only once. It starts with `tella_pk_`.
2. In the project folder, make your settings file from the example:
   - macOS / Linux: `cp .env.example .env`
   - Windows: `copy .env.example .env`
3. Open `.env` in any text editor and paste your key after `TELLA_API_KEY=`, like this:
   ```
   TELLA_API_KEY=tella_pk_abc123...
   ```

`.env` is ignored by git, so your key never gets uploaded.

**Check:**

```bash
node vedit.js tella list
```

You should see your Tella videos with their IDs.

**Skipping this step?** That's fine. Download recordings from Tella in your browser
and add them with `node vedit.js import <project> <file>` (Step 9).

> **Using Claude?** You can also connect Tella in claude.ai under **Settings → Connectors**, so Claude can browse your recordings for you.

## Step 5 — Set up Epidemic Sound

You can get music into a project in two ways.

**A. Through Claude (easiest).** In claude.ai, go to **Settings → Connectors** and
connect **Epidemic Sound**. Then open Claude Code in this folder and ask things like:

> Find calm lo-fi background music for my-video, no vocals, and add it.

Claude searches the catalogue, gives you preview links, can make a version of the
track cut to your video's exact length, and adds it to the project.
`CLAUDE.md` in this folder tells Claude how.

**B. By hand.** Download a track from [epidemicsound.com](https://www.epidemicsound.com), then:

```bash
node vedit.js music add my-video ~/Downloads/track.mp3 --title "Track name" --artist "Artist"
```

**Do this once either way:** in your Epidemic Sound account, add the YouTube channel
and social accounts you post to. That clears the music with YouTube's Content ID, so
your videos don't get copyright claims. Publish while your subscription is active.

## Step 6 — Check everything

```bash
node vedit.js doctor
```

Every line should show ✓ (lines with ! are optional). Any ✗ line comes with a
`fix:` line telling you what to run.

## Step 7 — Run the demo

```bash
node vedit.js demo
```

This makes a test recording, a test "music" tone and a "whoosh" with FFmpeg, then runs
the full pipeline. It takes one to three minutes. When it finishes, open:

- `projects/demo/exports/demo.mp4`: title card, test pattern with a name tag and captions, outro
- `projects/demo/exports/demo-vertical.mp4`: the same for Shorts/Reels

If both play with sound, **your setup is complete.**

---

## Making a real video

### Step 8 — Record in Tella

Record as usual. Don't worry about pauses or "umm, let me start again"; the tool cuts
long pauses automatically, and you can list other cuts in the settings.

### Step 9 — Create a project and bring in the recording

```bash
node vedit.js new my-video --title "How I Plan My Week"
```

Then either pull it from Tella:

```bash
node vedit.js tella list
node vedit.js tella pull my-video <video-id-from-the-list>
```

or use a file you downloaded:

```bash
node vedit.js import my-video ~/Downloads/recording.mp4
```

> **Tip:** instead of typing a file path, drag the file from Finder / Explorer into the
> terminal window; it pastes the full path. On Windows, use that instead of `~/Downloads/...`.

### Step 10 — Adjust the settings

Open `projects/my-video/project.json` in a text editor. The settings you'll change most:

| Setting | What it does | Default |
| ------- | ------------ | ------- |
| `title`, `subtitle` | Text on the intro card | project name, empty |
| `lowerThird.name`, `lowerThird.role` | Name tag shown near the start | `Your Name` |
| `outro.text`, `outro.cta` | End card text and button | `Thanks for watching`, `Subscribe for more` |
| `brand.accent` | Accent colour for bars and buttons | `#ff5a36` |
| `brand.logo` | Logo on intro and outro, e.g. `assets/logo.png` (put the file in that folder) | none |
| `edit.cutSilence.enabled` | Cut long pauses automatically | `true` |
| `edit.cutSilence.minSilence` | Only cut pauses longer than this many seconds | `0.8` |
| `edit.cutSilence.padding` | Seconds of pause to keep either side of a cut | `0.2` |
| `edit.cutSilence.thresholdDb` | What counts as silence; lower it (e.g. `-45`) if quiet words get cut | `-35` |
| `edit.trimStart`, `edit.trimEnd` | Drop everything before/after these times (seconds in the recording) | `0`, `null` (end) |
| `edit.cuts` | Extra cuts, e.g. `[{ "from": 61.5, "to": 74 }]` (seconds in the recording) | none |
| `intro.enabled` / `outro.enabled` | Turn the cards on or off; `duration` sets their length | on, 3 s / 4 s |
| `captions.enabled` | Burn in captions (see below) | `false` |
| `exports` | Which versions to make: `landscape`, `vertical`, `square` | `["landscape"]` |
| `format` | Canvas size and frame rate | 1920×1080, 30 fps |
| `master.lufs` | Final loudness; -14 suits YouTube and most platforms | `-14` |

**Captions** have two options:

- **From a subtitle file:** put an `.srt` or `.vtt` file in the project folder and set
  `"captions": { "enabled": true, "file": "captions.srt", "timing": "source" }`.
  `"source"` means the times match the original recording; the tool shifts them to
  match the cuts. Use `"edited"` if the file was made from the edited video.
- **Automatic:** set `"captions": { "enabled": true }` with no file. HyperFrames
  transcribes your voice. The first run downloads a speech model and can take a few
  minutes; if it fails, `npx hyperframes doctor` shows what's missing.

### Step 11 — Clean up the footage

```bash
node vedit.js prep my-video
node vedit.js info my-video
```

`prep` tells you how much it cut. `info` shows the final length. If the cuts feel too
tight or too loose, change the `edit.cutSilence` settings and run `prep` again.

### Step 12 — Add music and sound effects

Ask Claude (Step 5A), or add files by hand:

```bash
node vedit.js music add my-video ~/Downloads/track.mp3 --title "Track" --artist "Artist" --volume -10
node vedit.js sfx add my-video ~/Downloads/whoosh.wav --at main-0.3
```

- `--volume` is how far below your voice the music sits, in dB. `-10` is a good start;
  use `-14` for quieter music, `-6` for louder. The music also dips automatically
  while you talk, and fades in and out.
- `--at` is when a sound effect plays, in seconds (`12.5`) or relative to a section:
  `start`, `main` (where your footage begins), `outro`, `end`, with an optional offset.
  `main-0.3` puts a whoosh just before the intro cuts to your footage.
- Short tracks loop to fill the video. For a clean ending, have Claude make an
  Epidemic Sound edit at your video's exact length.

### Step 13 — Build and preview

```bash
node vedit.js build my-video
node vedit.js preview my-video
```

`preview` opens HyperFrames Studio in your browser so you can scrub through and check
the title, name tag and captions. Press `Ctrl+C` in the terminal to close it. The sound
in the preview is a rough mix; the export gets the proper one.

### Step 14 — Render

For a quick low-quality check:

```bash
node vedit.js render my-video --draft
```

Then the real thing:

```bash
node vedit.js render my-video
```

Rendering takes a few minutes per minute of video, depending on your computer.
Results land in `projects/my-video/exports/`:

| File | Use it for |
| ---- | ---------- |
| `my-video.mp4` | YouTube and other landscape uploads |
| `my-video-vertical.mp4` | Shorts, Reels, TikTok (if `vertical` is in `exports`) |
| `my-video-square.mp4` | Feeds that prefer square (if `square` is in `exports`) |
| `my-video-thumbnail.jpg` | A starting point for your thumbnail |
| `CREDITS.txt` | Music credits to paste into your description |

**Shortcut:** once your settings are right, `node vedit.js all my-video` runs prep,
build and render in one go.

---

## Making it your own

- **Look and feel:** copy `templates/theme.css` to `projects/my-video/assets/theme.css`
  and edit colours, fonts and sizes. Rebuild to see the change.
- **More advanced graphics:** HyperFrames compositions are HTML. Run
  `npx hyperframes skills update` to give Claude Code the HyperFrames skills, then ask it
  for things like animated callouts or a custom intro.
- **Fewer pauses cut:** raise `edit.cutSilence.minSilence` to `1.2` or set
  `enabled` to `false`.

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| `"ffmpeg" was not found` | Step 2, then open a **new** terminal window |
| `HyperFrames is not installed` | Run `npm install` in the project folder |
| Render says Chrome is missing | `npx hyperframes browser ensure` |
| `Tella rejected the API key (401)` | Check `.env`; make a new key in Tella if needed |
| Tella `403` | Downloads are turned off for that video in Tella; turn them on or download it by hand |
| Quiet words get cut out | Lower `edit.cutSilence.thresholdDb` to `-45` and raise `padding` to `0.3` |
| Music too loud or quiet | Change `music.volumeDb` in `project.json` (more negative = quieter) |
| Music link fails with 403/404 | Epidemic Sound download links expire. Get a fresh one and try again |
| Screen-recording colours look washed out | Set `render.videoFrameFormat` to `"png"` in `project.json` and render again |
| Anything else | `node vedit.js doctor` and `npx hyperframes doctor` |

## Command reference

```
node vedit.js doctor                          check the setup
node vedit.js demo                            end-to-end test with generated media
node vedit.js new <project> [--title ".."]    create a project
node vedit.js tella list                      list Tella recordings
node vedit.js tella pull <project> <id>       export + download from Tella
node vedit.js import <project> <file>         use a local recording
node vedit.js music add <project> <file|url> [--title] [--artist] [--id] [--volume -10]
node vedit.js sfx add <project> <file|url> --at <time> [--volume -6] [--title] [--id]
node vedit.js prep <project>                  FFmpeg clean-up and cuts
node vedit.js build <project>                 make the HyperFrames composition
node vedit.js preview <project>               open HyperFrames Studio
node vedit.js render <project> [--draft]      render, mix, master, export
node vedit.js all <project>                   prep + build + render
node vedit.js info <project> [--json]         lengths and settings
```
