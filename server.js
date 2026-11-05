const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

// ============================
// CORS
// ============================
app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});
app.options('*', (_req, res) => res.sendStatus(204));

app.use(express.json());

// ============================
// Token Minting (IP-authorized)
// ============================
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TOKEN_CACHE_MS = 4 * 60 * 1000;
const tokenCache = new Map();

function parseToken(text) {
    if (text == null) return '';
    const t = String(text).trim();
    if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
        try {
            const j = JSON.parse(t);
            if (typeof j === 'string') return j;
            if (j && typeof j === 'object') return j.token || j.data || j.string || j.result || '';
        } catch (e) {}
    }
    return t;
}

async function mintToken(origin, force) {
    const now = Date.now();
    const hit = tokenCache.get(origin);
    if (!force && hit && hit.expires > now) return hit.token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const res = await fetch(origin + '/generate.php', {
            credentials: 'omit',
            signal: controller.signal,
            headers: { 'User-Agent': UA },
        });
        const token = res.ok ? parseToken(await res.text()) : '';
        if (token) tokenCache.set(origin, { token: token, expires: now + TOKEN_CACHE_MS });
        return token;
    } finally {
        clearTimeout(timer);
    }
}

// ============================
// Server Definitions (ordered)
// ============================
// Server ordering as requested:
//   0: Fireworks (first)
//   1: Black Eye (second)
//   2: Whirlpool (third/fallback)
//   3: Sombrero (beta - unavailable, shows in list but unavailable)

const AUTHORIZED_IP = '143.44.168.54';

const SERVERS = [
    {
        name: 'Fireworks',
        position: 0,
        available: true,
        getVideoUrl(tmdb) {
            return {
                vUrl: `https://fireworks.example.com/hls/movie-${tmdb}/master.m3u8`,
                tUrl: `/api/sub/tt1234567`,
                minted: false,
                tToken: ''
            };
        },
        async mint(tmdb) {
            const origin = AUTHORIZED_IP;
            const token = await mintToken(origin, false);
            return { ...this.getVideoUrl(tmdb), tToken: token, minted: true };
        }
    },
    {
        name: 'Black Eye',
        position: 1,
        available: true,
        getVideoUrl(tmdb) {
            return {
                vUrl: `https://blckeye.example.com/hls/movie-${tmdb}/master.m3u8`,
                tUrl: `/api/sub/tt1234567`,
                minted: false,
                tToken: ''
            };
        },
        async mint(tmdb) {
            const origin = AUTHORIZED_IP;
            const token = await mintToken(origin, false);
            return { ...this.getVideoUrl(tmdb), tToken: token, minted: true };
        }
    },
    {
        name: 'Whirlpool',
        position: 2,
        available: true,
        getVideoUrl(tmdb) {
            return {
                vUrl: `https://whirlpool.example.com/hls/movie-${tmdb}/master.m3u8`,
                tUrl: `/api/sub/tt1234567`,
                minted: false,
                tToken: ''
            };
        },
        async mint(tmdb) {
            const origin = AUTHORIZED_IP;
            const token = await mintToken(origin, false);
            return { ...this.getVideoUrl(tmdb), tToken: token, minted: true };
        }
    },
    {
        name: 'Sombrero',
        position: 3,
        available: false,
        getVideoUrl(tmdb) {
            return {
                vUrl: null,
                tUrl: null,
                minted: false,
                tToken: ''
            };
        },
        async mint(tmdb) {
            return { ...this.getVideoUrl(tmdb), tToken: '', minted: false };
        }
    }
);

// ============================
// Endpoints
// ============================

/**
 * GET /api/movie/:tmdb_id
 * Returns movie info with server URLs in specified order.
 * Server ordering: Fireworks (first), Black Eye (second), Whirlpool (third/fallback), Sombrero (beta unavailable)
 */
app.get('/api/movie/:tmdb_id', async (req, res) => {
    const tmdb = req.params.tmdb_id;
    const namingMode = req.query.naming === 'universe' ? 'universe' : 'sequential';

    if (!tmdb) {
        return res.status(400).json({ success: false, error: 'missing :tmdb_id', example: '/api/movie/1339713' });
    }

    const servers = SERVERS.map((s, idx) => {
        const info = s.getVideoUrl(tmdb);
        return {
            id: idx + 1,
            name: s.name,
            available: s.available,
            tmdb,
            imdb: 'tt1234567', // Mock IMDb ID
            video_url: info.vUrl,
            thumbnail_url: `https://${s.name.toLowerCase().replace(/\s+/g, '')}.example.com/thumbs/movie-${tmdb}.jpg`,
            subtitle_url: info.tUrl,
            format: 'HLS · master.m3u8',
            server_name: s.name,
            position: s.position,
            token: info.tToken || '',
            tokenError: info.tToken ? null : 'token-unavailable'
        };
    });

    res.json({
        success: true,
        tmdb,
        naming_mode: namingMode,
        title: 'Movie ' + tmdb,
        servers,
        server_count: servers.length
    });
});

/**
 * GET /api/sub/:imdb_id
 * Returns subtitle tracks.
 */
app.get('/api/sub/:imdb_id', (req, res) => {
    const imdbId = req.params.imdb_id;

    if (!imdbId) {
        return res.status(400).json({ success: false, error: 'missing :imdb_id', example: '/api/sub/tt1234567' });
    }

    const subtitleData = {
        'tt1234567': {
            success: true,
            tracks: [
                { id: '1962434148', name: 'Obs.2025.720p.WEBRip.srt, language: eng', language: 'eng', format: 'srt' },
                { id: '1962434831', name: 'Obs.2026.1080p.CAM.srt, language: eng', language: 'eng', format: 'srt' }
            ],
            track_count: 2,
            formats: ['srt', 'vtt'],
            webvtt_base: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/'
        },
        'tt3896011': {
            success: true,
            tracks: [{ id: '1972345678', name: 'Sample.2024.1080p.WEB-DL.srt, language: eng', language: 'eng', format: 'srt' }],
            track_count: 1,
            formats: ['srt'],
            webvtt_base: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/'
        },
        'tt1234568': {
            success: true,
            tracks: [],
            track_count: 0,
            formats: [],
            webvtt_base: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/'
        }
    };

    const data = subtitleData[imdbId] || { success: true, tracks: [], track_count: 0, formats: [], webvtt_base: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' };

    res.json({
        success: data.success,
        imdb_id: imdbId,
        subtitle_track_count: data.track_count,
        subtitle_formats: data.formats,
        tracks: data.tracks,
        webvtt_base: data.webvtt_base
    });
});

/**
 * GET /api/sub/:imdb_id/:subtitle_id
 * Returns WebVTT subtitle URL.
 */
app.get('/api/sub/:imdb_id/:subtitle_id', (req, res) => {
    const imdbId = req.params.imdb_id;
    const subtitleId = req.params.subtitle_id;

    if (!subtitleId) {
        return res.status(400).json({ success: false, error: 'missing :subtitle_id' });
    }

    const webvttUrl = 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' + subtitleId + '.vtt';

    res.json({
        success: true,
        imdb_id: imdbId,
        subtitle_id: subtitleId,
        webvtt_url: webvttUrl,
        format: 'webvtt'
    });
});

/**
 * GET /api/player
 * Player placeholder.
 */
app.get('/api/player', (req, res) => {
    res.json({ success: true, message: 'Player endpoint - video player will be uploaded and connected later', endpoint: '/api/player', status: 'placeholder' });
});

/**
 * GET /health
 * Health check.
 */
app.get('/health', (req, res) => { res.json({ ok: true, project: 'galactic', time: new Date().toISOString() }); });

// 404 handler
app.use((_req, res) => { res.status(404).json({ success: false, error: 'endpoint not found' }); });

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
        console.log('  GET /health                    -> health check');
        console.log('');
        console.log('Server ordering:');
        console.log('  0: Fireworks (first)');
        console.log('  1: Black Eye (second)');
        console.log('  2: Whirlpool (third/fallback)');
        console.log('  3: Sombrero (beta - unavailable)');
        console.log('');
        console.log('Token minting: IP-authorized via authorized IP 143.44.168.54');
        console.log('OpenSubtitles: https://rest.opensubtitles.org/search/imdbid-.../sublanguageid-eng');
        console.log('WebVTT URLs: ${NEXUS}/embed/iframe_player/cache/subs/19/{IDSubtitleFile}.vtt');
    });
}

module.exports = app;