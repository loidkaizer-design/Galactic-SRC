# Galactic-SRC

**Galactic** — Simple HLS playlist API endpoint for movie/series extraction with multiple server sources and subtitle support.

## 📡 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check endpoint |
| `GET /api/movie/:tmdb_id` | Movie info with server playlist URLs |
| `GET /api/sub/:imdb_id` | Subtitle tracks by IMDb ID |
| `GET /api/sub/:imdb_id/:subtitle_id` | WebVTT subtitle URL |
| `GET /api/player` | Player placeholder endpoint |

## 🏷️ Server Ordering

Servers are returned in this specific order:

| Position | Name | Status |
|----------|------|--------|
| 0 | **Fireworks** | First server |
| 1 | **Black Eye** | Second server |
| 2 | **Whirlpool** | Third/fallback server |
| 3 | **Sombrero** | Beta - **unavailable** (shows in list but marked unavailable) |

## 🎬 GET /api/movie/:tmdb_id

Returns movie information with HLS playlist URLs from multiple sources.

### Request
```http
GET /api/movie/1339713
GET /api/movie/1339713?naming=universe
```

### Query Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `naming` | Server naming mode | `sequential` |
| | `sequential` | Server 1, Server 2... |
| | `universe` | Milkyway, Andromeda, Orion... |

### Example Response (TMDB 1339713)

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
```

### Server Data Fields

| Field | Description |
|-------|-------------|
| `id` | Server position (1-4) |
| `name` | Server name (Fireworks, Black Eye, Whirlpool, Sombrero) |
| `available` | Whether server is currently available |
| `tmdb` | TMDB movie ID |
| `imdb` | IMDb ID |
| `video_url` | HLS master.m3u8 playlist URL |
| `thumbnail_url` | Poster thumbnail image URL |
| `subtitle_url` | Link to subtitle endpoint |
| `format` | Media format |
| `server_name` | Alias for `name` |
| `position` | Zero-based position (0-3) |
| `beta` | Whether server is in beta (Sombrero only) |
| `status` | Server status ("unavailable" for Sombrero) |

### Naming Modes

#### Sequential Mode (default)
```
Server 1 → Fireworks
Server 2 → Black Eye  
Server 3 → Whirlpool
Server 4 → Sombrero (unavailable)
```

#### Universe Mode
```
?naming=universe
Server 0 → Milkyway
Server 1 → Andromeda
Server 2 → Orion
Server 3 → Sombrero (beta - unavailable)
```

## 📝 GET /api/sub/:imdb_id

Returns subtitle tracks by IMDb ID.

### Request
```http
GET /api/sub/tt1234567
```

### Example Response

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

### Subtitle Format
- `srt` - Standard SRT subtitle format
- `vtt` - WebVTT subtitle format

### WebVTT URL
To get the actual WebVTT file:
```http
GET /api/sub/tt1234567/1962434148
```

### Response
```json
{
    "success": true,
    "imdb_id": "tt1234567",
    "subtitle_id": "1962434148",
    "webvtt_url": "https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/1962434148.vtt",
    "format": "webvtt"
}
```

## 🎥 GET /api/player

Placeholder endpoint for video player. Will be connected when player is uploaded.

### Response
```json
{
    "success": true,
    "message": "Player endpoint - video player will be uploaded and connected later",
    "endpoint": "/api/player",
    "status": "placeholder"
}
```

## 🔧 Getting Started

### Running Locally

```bash
# Install dependencies
npm install express

# Start server
node server.js

# Server runs on http://localhost:3001
```

### Docker

```dockerfile
FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
CMD ["node", "server.js"]
```

## 📦 Deployment

The project is configured for easy deployment on platforms that support Node.js applications. The server listens on port 3001 and can be deployed to:

- Render.com
- Railway
- Fly.io
- VPS with Node.js

## 🛠️ Technology Stack

- **Node.js** v20+
- **Express** web framework
- **CORS** enabled for all origins
- **RESTful** API design

## 📄 License

MIT License - feel free to use and modify.

## 👨‍💻 Author

Created as part of the foltynsrc/Galactic project - HLS playlist replica ecosystem.

---

*For more information, visit: https://github.com/loidkaizer-design/Galactic-SRC*