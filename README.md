# FLAC Player

A native Windows 11 FLAC music player with album grid view and star ratings, built with Electron.

## Features

- **Album Grid** — browse your library by album artwork extracted from file metadata
- **Track List** — view all tracks in a flat list
- **Album Detail** — click any album to see its tracklist with disc/track ordering
- **Now Playing Bar** — persistent player with progress scrubbing, volume control
- **Quality Display** — shows bit depth and sample rate (e.g. `24bit · 96kHz`)
- **Search** — filter albums, artists, and tracks in real time
- **Sort** — by album name, artist, or year
- **Keyboard-friendly** transport controls
- **Star Ratings** — rate tracks from 1-5 stars, saved directly to FLAC file metadata

## Requirements

- Node.js 20+ (https://nodejs.org)
- Windows 10/11 (64-bit)

## Quick Start

```bash
# 1. Install dependencies (delete node_modules first if upgrading)
npm install

# 2. Run the app
npm start
```

## Build a distributable .exe installer

```bash
npm run build
```

The installer will be in the `dist/` folder.

## Build a portable version

```bash
npm run build:portable
```

The portable executable will be in the `dist/` folder.

## How it works

1. Click **Open Music Folder** and pick your FLAC library root
2. The app recursively scans for `.flac` files and reads metadata using `music-metadata`
3. Albums are grouped by `ALBUMARTIST` + `ALBUM` tags
4. Embedded cover art is displayed in the grid
5. Click any album to open it, or click the play overlay to start immediately
6. Audio is played natively by the browser's Web Audio engine (supports FLAC)

## Tips

- Your files should have proper tags: `TITLE`, `ARTIST`, `ALBUMARTIST`, `ALBUM`, `TRACKNUMBER`, `DATE`
- Embedded cover art (PICTURE tag) is used for album artwork
- Large libraries (1000+ files) may take a few seconds to scan on first open
