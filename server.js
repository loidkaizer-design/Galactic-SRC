const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

// ============================
// CORS middleware
// ============================
app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});

// Parse JSON bodies
app.use(express.json());

// ============================
// Server definitions (ordered: Fireworks, Black Eye, Whirlpool, Sombrero)
// ============================
// Integrates real vidsrc.to extraction with token minting

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const GATE = 'https://vsembed.ru/vs_src.php';
const NEXUS = 'https://stellarconductornexus.com';

// Universe names for naming mode
const UNIVERSE_NAMES = [
    'Milkyway', 'Andromeda', 'Orion', 'Sombrero', 'Whirlpool',
    'Triangulum', 'Cigar', 'Pinwheel', 'Tadpole', 'Cartwheel'
];

function universeName(index) {
    return UNIVERSE_NAMES[index % UNIVERSE_NAMES.length];
}

function serverName(index, mode) {
    if (mode === 'universe') return universeName(index);
    return `Server ${index + 1}`;
}

// Token minting (IP-authorized)
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
            headers: { 'User-Agent': UA, 'Referer': NEXUS },
        });
        const token = res.ok ? parseToken(await res.text()) : '';
        if (token) tokenCache.set(origin, { token: token, expires: now + TOKEN_CACHE_MS });
        return token;
    } finally {
        clearTimeout(timer);
    }
}

function withTokenUrl(url, token) {
    const u = new URL(url);
    u.searchParams.set('token', token);
    return u.toString();
}

// Helper
function extract(html, key) {
    const m = html.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'));
    return m ? m[1] : null;
}

// vidsrc.to extraction logic (adapted from foltynsrc)
async function fetchJson(url, headers = {}) {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        redirect: 'follow',
    });
    return res.json();
}

async function fetchText(url, headers = {}) {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        redirect: 'follow',
    });
    return res.text();
}

// Server info extraction from vidsrc.to
function extract_tmdb(html, key) {
    const m = html.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'));
    return m ? m[1] : null;
}

// Named servers configuration
const NAMED_SERVERS = [
    // 0: Fireworks (first)
    {
        name: 'Fireworks',
        position: 0,
        getServerUrl(tmdb, namingMode) {
            // Try vidsrc.to extraction first, fallback to example
            return this.extractFromVidsrc(tmdb).then(info => info.video_url || `https://fireworks.example.com/hls/movie-${tmdb}/master.m3u8`);
        },
        async extractFromVidsrc(tmdb) {
            try {
                // vidsrc.to gate
                const gateJson = await fetchJson(`${GATE}?type=movie&id=${tmdb}`, {
                    'Accept': 'application/json',
                    'Referer': 'https://vidsrc.to/',
                });
                if (!gateJson || !gateJson.src) return { video_url: null, imdb: '' };

                const page1Url = gateJson.src;
                const html1 = await fetchText(page1Url, { 'Referer': 'https://vsembed.ru/' });
                const playerUrlPath = html1.match(new RegExp('"playerUrl"\\s*:\\s*"([^"]+)"'));
                if (!playerUrlPath) return { video_url: null, imdb: '' };

                const page2Url = NEXUS + playerUrlPath[1];
                const html2 = await fetchText(page2Url, { 'Referer': NEXUS });
                const api = html2.match(new RegExp('"api"\\s*:\\s*"([^"]+)"'));
                const token = html2.match(new RegExp('"apiToken"\\s*:\\s*"([^"]+)"'));

                if (!api) return { video_url: null, imdb: '' };

                const streamUrl = api[1] + '&api_token=' + (token ? encodeURIComponent(token[1]) : '');
                const json = await fetchJson(streamUrl, {
                    'Accept': 'application/json',
                    'Referer': NEXUS,
                });

                if (json.status_code && String(json.status_code) !== '200') return { video_url: null, imdb: '' };

                let wasmUrl = json.vs && json.vs.wasm_url ? json.vs.wasm_url : null;
                let streamUrls = json.data && json.data.stream_urls;

                if (typeof streamUrls === 'string') {
                    if (!wasmUrl) return { video_url: null, imdb: '' };
                    // Decrypt would require WASM, using mock for now
                    streamUrls = await this.decryptStreamUrls(streamUrls, wasmUrl);
                }

                if (!Array.isArray(streamUrls) || streamUrls.length === 0) return { video_url: null, imdb: '' };

                // Mint token for the origin
                const origin = streamUrls[0].match(/^https?:\/\/[^/]+/)[0];
                let token = '';
                try { token = await mintToken(origin, false); } catch (e) {}

                const stamped = await applyToken(streamUrls[0], token);
                const imdb = json.data && json.data.imdb_id ? json.data.imdb_id : '';

                return { video_url: stamped, imdb: imdb };
            } catch (e) {
                console.error('vidsrc.to extraction error:', e.message);
                return { video_url: null, imdb: '' };
            }
        },
    },
    // 1: Black Eye (second)
    {
        name: 'Black Eye',
        position: 1,
        getServerUrl(tmdb, namingMode) {
            return this.extractFromVidsrc(tmdb).then(info => info.video_url || `https://blckeye.example.com/hls/movie-${tmdb}/master.m3u8`);
        },
        async extractFromVidsrc(tmdb) {
            // Same extraction logic as Fireworks
            return this.servers[0].extractFromVidsrc(tmdb);
        },
    },
    // 2: Whirlpool (third/fallback)
    {
        name: 'Whirlpool',
        position: 2,
        getServerUrl(tmdb, namingMode) {
            return this.extractFromVidsrc(tmdb).then(info => info.video_url || `https://whirlpool.example.com/hls/movie-${tmdb}/master.m3u8`);
        },
        async extractFromVidsrc(tmdb) {
            return this.servers[0].extractFromVidsrc(tmdb);
        },
    },
    // 3: Sombrero (beta - unavailable)
    {
        name: 'Sombrero',
        position: 3,
        available: false,
        getServerUrl(tmdb, namingMode) {
            return Promise.resolve(null);
        },
    },
];

// Apply token to URL
function applyToken(url, token) {
    if (!token) return url;
    if (url.indexOf('__TOKEN__') > -1) return url.split('__TOKEN__').join(token);
    return url + (url.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

// Async function to decrypt stream URLs (WASM-based)
async function decryptStreamUrls(encB64, wasmUrl) {
    // In production, this would use WebAssembly
    // For now, return mock decrypted URLs
    const decrypted = encB64.split('\\n').filter((s) => s).map((s) => {
        // Mock: prepend a real-like URL
        return 'https://example.stream/' + btoa(s).substring(0, 20) + '.m3u8';
    });
    return decrypted;
}

// Get server URL with token minting
async function getServerVideoUrl(tmdb, namingMode) {
    const server = NAMED_SERVERS.find(s => s.name === 'Fireworks'); // Simplified for demo
    // In production, would cycle through servers based on position
    return server.getServerUrl(tmdb, namingMode);
}

// Naming mode helper
function namingName(index, mode) {
    if (mode === 'universe') {
        const names = ['Milkyway', 'Andromeda', 'Orion', 'Sombrero', 'Whirlpool', 'Triangulum'];
        return names[index % names.length] || `Server ${index + 1}`;
    }
    return `Fireworks ${index + 1}`;
}

// ============================
// Endpoints
// ============================

/**
 * GET /api/movie/:tmdb_id
 * Returns movie info with servers in specified order:
 * Fireworks (first), Black Eye (second), Whirlpool (third/fallback), Sombrero (beta unavailable)
 */
app.get('/api/movie/:tmdb_id', async (req, res) => {
    const tmdb = req.params.tmdb_id;
    const namingMode = req.query.naming === 'universe' ? 'universe' : 'sequential';
    
    if (!tmdb) {
        return res.status(400).json({
            success: false,
            error: 'missing :tmdb_id'
        });
    }

    const servers = await Promise.all(NAMED_SERVERS.map((server, index) => {
        return getServerVideoUrl(tmdb, namingMode).then(info => {
            const available = info.video_url ? true : false;
            return {
                id: index + 1,
                name: server.name,
                available: available,
                tmdb,
                imdb: info.imdb || '',
                video_url: info.video_url || `https://${server.name.toLowerCase().replace(/\s+/g, '')}.example.com/hls/movie-${tmdb}/master.m3u8`,
                thumbnail_url: `https://${server.name.toLowerCase().replace(/\s+/g, '')}.example.com/thumbs/movie-${tmdb}.jpg`,
                subtitle_url: `/api/sub/${info.imdb || 'unknown'}`,
                format: 'HLS · master.m3u8',
                server_name: server.name,
                position: server.position,
                token: info.token || '',
                tokenError: info.tokenError || null
            };
        }).catch(err => {
            // Fallback on error
            return {
                id: index + 1,
                name: server.name,
                available: false,
                tmdb,
                imdb: '',
                video_url: `https://${server.name.toLowerCase().replace(/\s+/g, '')}.example.com/hls/movie-${tmdb}/master.m3u8`,
                thumbnail_url: `https://${server.name.toLowerCase().replace(/\s+/g, '')}.example.com/thumbs/movie-${tmdb}.jpg`,
                subtitle_url: '/api/sub/unknown',
                format: 'HLS · master.m3u8',
                server_name: server.name,
                position: server.position,
                token: '',
                tokenError: err.message
            };
        });
    }));

    res.json({
        success: true,
        tmdb,
        naming_mode: namingMode,
        title: `Movie ${tmdb}`,
        servers,
        server_count: servers.length
    });
});

/**
 * GET /api/sub/:imdb_id
 * Returns subtitle tracks for the given IMDb ID
 */
app.get('/api/sub/:imdb_id', (req, res) => {
    const imdbId = req.params.imdb_id;
    
    if (!imdbId) {
        return res.status(400).json({
            success: false,
            error: 'missing :imdb_id'
        });
    }

    const subtitleData = {
        'tt1234567': {
            success: true,
            tracks: [
                { id: '1962434148', name: 'Obsession.2025.720p.WEBRip.x264.AAC-YTS.srt, language: eng', language: 'eng', format: 'srt' },
                { id: '1962434831', name: 'Obsession.2026.1080p.CAM.x264-DKS_ENG.srt, language: eng', language: 'eng', format: 'srt' }
            ],
            track_count: 2,
            formats: ['srt', 'vtt'],
            webvtt_base: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/'
        },
        'tt3896011': {
            success: true,
            tracks: [
                { id: '1972345678', name: 'Sample.Sub.2024.1080p.WEB-DL.srt, language: eng', language: 'eng', format: 'srt' }
            ],
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

    const data = subtitleData[imdbId] || {
        success: true,
        tracks: [],
        track_count: 0,
        formats: [],
        webvtt_base: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/'
    };

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
 * Returns WebVTT subtitle URL
 */
app.get('/api/sub/:imdb_id/:subtitle_id', (req, res) => {
    const imdbId = req.params.imdb_id;
    const subtitleId = req.params.subtitle_id;

    if (!subtitleId) {
        return res.status(400).json({
            success: false,
            error: 'missing :subtitle_id'
        });
    }

    const NEXUS = 'https://stellarconductornexus.com';
    const webvttUrl = `${NEXUS}/embed/iframe_player/cache/subs/19/${subtitleId}.vtt`;

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
 * Player page placeholder
 */
app.get('/api/player', (req, res) => {
    res.json({
        success: true,
        message: 'Player endpoint - video player will be uploaded and connected later',
        endpoint: '/api/player',
        status: 'placeholder'
    });
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({ ok: true, project: 'galactic' });
});

// 404 handler
app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'endpoint not found' });
});

// Start server (only runs locally, not in Vercel serverless)
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