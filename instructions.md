# Galactic-SRC API Documentation

## Overview

Galactic-SRC is a simple HLS playlist API endpoint for movie/series extraction with multiple server sources and subtitle support. This document explains how to use the API to get movie URLs, subtitle lists, and WebVTT subtitles.

## Base URL

```
https://galacticsrc.vercel.app
```

## API Endpoints

### 1. Get Movie Info with Server URLs

**Endpoint:** `GET /api/movie/:tmdb_id`

**Description:** Returns movie information with HLS playlist URLs from multiple servers in specified order.

**Query Parameters:**

| Parameter | Description | Default |
|-----------|-------------|---------|
| `naming` | Server naming mode | `sequential` |
| | `sequential` | Server 1, Server 2... |
| | `universe` | Milkyway, Andromeda, Orion... |

**Example Requests:**

```bash
# Sequential mode (default)
curl "https://galacticsrc.vercel.app/api/movie/1339713"

# Universe mode
curl "https://galacticsrc.vercel.app/api/movie/1339713?naming=universe"
```

**Example Response:**

```json
{
    "success": true,
    "tmdb": "1339713",
    "naming_mode": "sequential",
    "title": "Movie 1339713",
    "servers": [
        {
            "id": 1,
            "name": "Fireworks",
            "available": true,
            "tmdb": "1339713",
            "imdb": "tt1234567",
            "video_url": "https://fireworks.example.com/hls/movie-1339713/master.m3u8",
            "thumbnail_url": "https://fireworks.example.com/thumbs/movie-1339713.jpg",
            "subtitle_url": "/api/sub/tt1234567",
            "format": "HLS · master.m3u8",
            "server_name": "Fireworks",
            "position": 0
        },
        {
            "id": 2,
            "name": "Black Eye",
            "available": true,
            "tmdb": "1339713",
            "imdb": "tt1234567",
            "video_url": "https://blckeye.example.com/hls/movie-1339713/master.m3u8",
            "thumbnail_url": "https://blckeye.example.com/thumbs/movie-1339713.jpg",
            "subtitle_url": "/api/sub/tt1234567",
            "format": "HLS · master.m3u8",
            "server_name": "Black Eye",
            "position": 1
        },
        {
            "id": 3,
            "name": "Whirlpool",
            "available": true,
            "tmdb": "1339713",
            "imdb": "tt1234567",
            "video_url": "https://whirlpool.example.com/hls/movie-1339713/master.m3u8",
            "thumbnail_url": "https://whirlpool.example.com/thumbs/movie-1339713.jpg",
            "subtitle_url": "/api/sub/tt1234567",
            "format": "HLS · master.m3u8",
            "server_name": "Whirlpool",
            "position": 2
        },
        {
            "id": 4,
            "name": "Sombrero",
            "available": false,
            "tmdb": "1339713",
            "imdb": "",
            "video_url": null,
            "thumbnail_url": null,
            "subtitle_url": null,
            "format": "HLS · master.m3u8",
            "beta": true,
            "status": "unavailable",
            "server_name": "Sombrero",
            "position": 3
        }
    ],
    "server_count": 4
}
```

**Server Ordering:**

| Position | Name | Status |
|----------|------|--------|
| 0 | Fireworks | First server (available) |
| 1 | Black Eye | Second server (available) |
| 2 | Whirlpool | Third/fallback server (available) |
| 3 | Sombrero | Beta - unavailable (shows in list but marked unavailable) |

**How to Use Video URLs:**

- The `video_url` field contains the HLS playlist URL for each server
- Servers 1-3 are available for playback
- Server 4 (Sombrero) is unavailable - do not use for playback
- The `subtitle_url` points to the subtitle endpoint for that movie

---

### 2. Get Subtitle Tracks

**Endpoint:** `GET /api/sub/:imdb_id`

**Description:** Returns subtitle tracks by IMDb ID. Handles both array and object formats.

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `:imdb_id` | IMDb ID (e.g., `tt1234567`) |

**Example Request:**

```bash
curl "https://galacticsrc.vercel.app/api/sub/tt1234567"
```

**Example Response:**

```json
{
    "success": true,
    "imdb_id": "tt1234567",
    "subtitle_track_count": 2,
    "subtitle_formats": ["srt", "vtt"],
    "tracks": [
        {
            "id": "1962434148",
            "name": "Obsession.2025.720p.WEBRip.x264.AAC-YTS.srt, language: eng",
            "language": "eng",
            "format": "srt"
        },
        {
            "id": "1962434831",
            "name": "Obsession.2026.1080p.CAM.x264-DKS_ENG.srt, language: eng",
            "language": "eng",
            "format": "srt"
        }
    ],
    "webvtt_base": "https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/"
}
```

**Field Descriptions:**

- `subtitle_track_count`: Number of available subtitle tracks
- `subtitle_formats`: Available formats (`srt`, `vtt`)
- `tracks`: Array of subtitle track objects:
  - `id`: Subtitle ID (use with Step 3)
  - `name`: Subtitle filename and description
  - `language`: Language code (`eng` = English)
  - `format`: Subtitle format (`srt` or `vtt`)
- `webvtt_base`: Base URL for WebVTT generation (used in Step 3)

**IMDB IDs Supported:**

| IMDb ID | Subtitle Tracks |
|---------|----------------|
| `tt1234567` | 2 tracks (srt, vtt formats) |
| `tt3896011` | 1 track (srt format) |
| `tt1234568` | 0 tracks (empty) |

---

### 3. Get WebVTT Subtitle URL

**Endpoint:** `GET /api/sub/:imdb_id/:subtitle_id`

**Description:** Returns the WebVTT subtitle URL for a specific subtitle ID.

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `:imdb_id` | IMDb ID (e.g., `tt1234567`) |
| `:subtitle_id` | Subtitle ID (e.g., `1962434148`) |

**Example Request:**

```bash
# Get WebVTT URL for subtitle ID 1962434148
curl "https://galacticsrc.vercel.app/api/sub/tt1234567/1962434148"
```

**Example Response:**

```json
{
    "success": true,
    "imdb_id": "tt1234567",
    "subtitle_id": "1962434148",
    "webvtt_url": "https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/1962434148.vtt",
    "format": "webvtt"
}
```

**WebVTT URL Format:**

```
https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/{IDSubtitleFile}.vtt
```

**How to Fetch the Actual Subtitle:**

```bash
# Get the WebVTT file content
curl -s "https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/1962434148.vtt" > subtitles.vtt

# Or using wget
wget -O subtitles.vtt "https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/1962434148.vtt"
```

**Sample WebVTT Content:**

```
WEBVTT

1
00:00:06.000 --> 00:00:12.074
Watch Online Movies and Series for FREE
www.osdb.link/lm

2
00:01:10.281 --> 00:01:12.083
Ever since we...

3
00:01:14.884 --> 00:01:17.687
You're the only person
that I've ever...

4
00:01:18.521 --> 00:01:21.092
Sorry, this is weird.
I-I don't talk like this.
```

---

### 4. Player Endpoint

**Endpoint:** `GET /api/player`

**Description:** Player placeholder endpoint. Will be connected to video player when uploaded.

**Example Request:**

```bash
curl "https://galacticsrc.vercel.app/api/player"
```

**Example Response:**

```json
{
    "success": true,
    "message": "Player endpoint - video player will be uploaded and connected later",
    "endpoint": "/api/player",
    "status": "placeholder"
}
```

---

### 5. Health Check

**Endpoint:** `GET /health`

**Description:** Returns API health status.

**Example Request:**

```bash
curl "https://galacticsrc.vercel.app/health"
```

**Example Response:**

```json
{
    "ok": true,
    "project": "galactic",
    "time": "2026-11-05T14:00:00.000Z"
}
```

---

## Complete Workflow Example

### Getting Full Movie Information with Subtitles

**Step 1: Get Movie Data**

```bash
curl "https://galacticsrc.vercel.app/api/movie/1339713"
```

**Response gives you:**
- `video_url` from Server 1 (Fireworks): `https://fireworks.example.com/hls/movie-1339713/master.m3u8`
- `subtitle_url`: `/api/sub/tt1234567`

**Step 2: Get Subtitle Tracks**

```bash
curl "https://galacticsrc.vercel.app/api/sub/tt1234567"
```

**Response gives you:**
- `tracks` array with subtitle information
- Note the `id` of desired subtitle (e.g., `1962434148`)

**Step 3: Get WebVTT URL**

```bash
curl "https://galacticsrc.vercel.app/api/sub/tt1234567/1962434148"
```

**Response gives you:**
- `webvtt_url`: `https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/1962434148.vtt`

**Step 4: Fetch Subtitle Content**

```bash
curl -s "https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/1962434148.vtt" > subtitles.vtt
```

---

## Naming Modes

### Sequential Mode (Default)

```bash
curl "https://galacticsrc.vercel.app/api/movie/1339713"
```

- Server 1: Fireworks
- Server 2: Black Eye
- Server 3: Whirlpool
- Server 4: Sombrero (unavailable)

### Universe Mode

```bash
curl "https://galacticsrc.vercel.app/api/movie/1339713?naming=universe"
```

- Server 0: Milkyway
- Server 1: Andromeda
- Server 2: Orion
- Server 3: Sombrero (beta unavailable)

---

## Error Handling

### Common Error Responses

| Status Code | Meaning |
|-------------|---------|
| `400` | Bad request - missing required parameters |
| `404` | Endpoint not found |
| `500` | Internal server error |

**Example 400 Error:**

```json
{
    "success": false,
    "error": "missing :tmdb_id"
}
```

**Example 400 Error (subtitles):**

```json
{
    "success": false,
    "error": "missing :imdb_id"
}
```

---

## Authentication & Access

- **CORS:** All endpoints enable CORS for all origins (`Access-Control-Allow-Origin: *`)
- **IP Authorization:** Your IP `143.44.168.54` is authorized for token minting via `/generate.php`
- **No API Key Required:** Endpoints are publicly accessible
- **Rate Limits:** API is designed for moderate usage; excessive requests may be throttled

---

## Deployment & Self-Hosting

### Vercel Deployment

1. Connect your GitHub repository to Vercel
2. The `vercel.json` configuration will auto-configure the Node.js server
3. Deploy - your API will be available at `https://your-project.vercel.app`

### Self-Hosting Locally

```bash
# Clone the repository
git clone https://github.com/loidkaizer-design/Galactic-SRC.git
cd Galactic-SRC

# Install dependencies
npm install

# Start the server
node server.js

# API will be available at http://localhost:3001
```

### Docker Deployment

```dockerfile
FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
CMD ["node", "server.js"]
```

---

## API Reference Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/movie/:tmdb_id` | GET | Movie info with server URLs |
| `/api/sub/:imdb_id` | GET | Subtitle tracks |
| `/api/sub/:imdb_id/:subtitle_id` | GET | WebVTT subtitle URL |
| `/api/player` | GET | Player placeholder |

**Naming Mode Parameter:** `?naming=sequential` or `?naming=universe`

**Success Response Format:** All endpoints return JSON with `success: true` field.

**Error Response Format:** All endpoints return JSON with `success: false` and `error` field on failure.

---

## Repository

**GitHub:** https://github.com/loidkaizer-design/Galactic-SRC

**Clone:**

```bash
git clone https://github.com/loidkaizer-design/Galactic-SRC.git
```

**Download:** https://github.com/loidkaizer-design/Galactic-SRC/archive/refs/heads/main.zip

---

## Contact & Support

For issues, questions, or contributions, please visit the GitHub repository above. The API is open source under the MIT license.

---
*Galactic-SRC API Documentation - Generated from repository documentation*