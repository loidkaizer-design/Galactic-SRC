const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

// CORS
app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});

// Parse JSON bodies
app.use(express.json());

// Server definitions (ordered: Fireworks, Black Eye, Whirlpool, Sombrero)
const SERVERS = [
    {
        name: 'Fireworks',
        position: 0,
        available: true,
        getInfo(tmdb, namingMode) {
            const imdbIds = { '1339713': 'tt1234567', '61306': 'tt3896011', '242561': 'tt1234568' };
            return {
                tmdb,
                imdb: imdbIds[tmdb] || '',
                video_url: `https://fireworks.example.com/hls/movie-${tmdb}/master.m3u8`,
                thumbnail_url: `https://fireworks.example.com/thumbs/movie-${tmdb}.jpg`,
                subtitle_url: `/api/sub/${imdbIds[tmdb] || 'unknown'}`,
                format: 'HLS · master.m3u8'
            };
        }
    },
    {
        name: 'Black Eye',
        position: 1,
        available: true,
        getInfo(tmdb, namingMode) {
            const imdbIds = { '1339713': 'tt1234567', '61306': 'tt3896011', '242561': 'tt1234568' };
            return {
                tmdb,
                imdb: imdbIds[tmdb] || '',
                video_url: `https://blckeye.example.com/hls/movie-${tmdb}/master.m3u8`,
                thumbnail_url: `https://blckeye.example.com/thumbs/movie-${tmdb}.jpg`,
                subtitle_url: `/api/sub/${imdbIds[tmdb] || 'unknown'}`,
                format: 'HLS · master.m3u8'
            };
        }
    },
    {
        name: 'Whirlpool',
        position: 2,
        available: true,
        getInfo(tmdb, namingMode) {
            const imdbIds = { '1339713': 'tt1234567', '61306': 'tt3896011', '242561': 'tt1234568' };
            return {
                tmdb,
                imdb: imdbIds[tmdb] || '',
                video_url: `https://whirlpool.example.com/hls/movie-${tmdb}/master.m3u8`,
                thumbnail_url: `https://whirlpool.example.com/thumbs/movie-${tmdb}.jpg`,
                subtitle_url: `/api/sub/${imdbIds[tmdb] || 'unknown'}`,
                format: 'HLS · master.m3u8'
            };
        }
    },
    {
        name: 'Sombrero',
        position: 3,
        available: false,
        getInfo(tmdb, namingMode) {
            return { tmdb, imdb: '', video_url: null, thumbnail_url: null, subtitle_url: null, format: 'HLS · master.m3u8', beta: true, status: 'unavailable' };
        }
    }
];

// Endpoints
app.get('/health', (req, res) => res.json({ ok: true, project: 'galactic' }));
app.get('/api/movie/:tmdb_id', (req, res) => {
    const tmdb = req.params.tmdb_id;
    const namingMode = req.query.naming === 'universe' ? 'universe' : 'sequential';
    if (!tmdb) return res.status(400).json({ success: false, error: 'missing :tmdb_id' });

    const servers = SERVERS.map((server, index) => {
        const info = server.getInfo(tmdb, namingMode);
        return { id: index + 1, name: server.name, available: server.available, ...info, server_name: server.name, position: server.position };
    });

    res.json({ success: true, tmdb, naming_mode: namingMode, title: `Movie ${tmdb}`, servers, server_count: servers.length });
});
app.get('/api/sub/:imdb_id', (req, res) => {
    const imdbId = req.params.imdb_id;
    if (!imdbId) return res.status(400).json({ success: false, error: 'missing :imdb_id' });
    const subtitleData = {
        'tt1234567': { success: true, tracks: [{ id: '1962434148', name: 'Obs.2025.720p.WEBRip.srt', language: 'eng', format: 'srt' }, { id: '1962434831', name: 'Obs.2026.1080p.CAM.srt', language: 'eng', format: 'srt' }], track_count: 2, formats: ['srt', 'vtt'], webvtt_base: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' },
        'tt3896011': { success: true, tracks: [{ id: '1972345678', name: 'Sample.2024.1080p.WEB-DL.srt', language: 'eng', format: 'srt' }], track_count: 1, formats: ['srt'], webvtt_base: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' },
        'tt1234568': { success: true, tracks: [], track_count: 0, formats: [], webvtt_base: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' }
    };
    const data = subtitleData[imdbId] || { success: true, tracks: [], track_count: 0, formats: [], webvtt_base: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' };
    res.json({ success: data.success, imdb_id: imdbId, subtitle_track_count: data.track_count, subtitle_formats: data.formats, tracks: data.tracks, webvtt_base: data.webvtt_base });
});
app.get('/api/sub/:imdb_id/:subtitle_id', (req, res) => {
    const subtitleId = req.params.subtitle_id;
    if (!subtitleId) return res.status(400).json({ success: false, error: 'missing :subtitle_id' });
    res.json({ success: true, imdb_id: req.params.imdb_id, subtitle_id, webvtt_url: `https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/${subtitleId}.vtt`, format: 'webvtt' });
});
app.get('/api/player', (req, res) => res.json({ success: true, message: 'Player endpoint - video player will be uploaded and connected later', endpoint: '/api/player', status: 'placeholder' }));

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`galactic API listening on http://localhost:${PORT}`);
        console.log('Endpoints:');
        console.log('  GET /health                    -> health check');
        console.log('  GET /api/movie/:tmdb_id        -> movie info with servers');
        console.log('  GET /api/sub/:imdb_id          -> subtitle tracks');
        console.log('  GET /api/sub/:imdb_id/:subtitle_id -> WebVTT subtitle URL');
        console.log('  GET /api/player                -> player placeholder');
        console.log('');
        console.log('Server ordering:');
        console.log('  0: Fireworks (first)');
        console.log('  1: Black Eye (second)');
        console.log('  2: Whirlpool (third/fallback)');
        console.log('  3: Sombrero (beta - unavailable)');
    });
}
module.exports = app;