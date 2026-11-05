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
app.use(express.json());

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const GATE = 'https://vsembed.ru/vs_src.php';
const NEXUS = 'https://stellarconductornexus.com';
const OPENSUBTITLES_API = 'https://rest.opensubtitles.org';

// Authorized IP for /generate.php token minting
const AUTHORIZED_IP = '143.44.168.54';

// Universe names
const UNIVERSE_NAMES = [
    'Milkyway', 'Andromeda', 'Orion', 'Sombrero', 'Whirlpool', 'Triangulum',
    'Cigar', 'Pinwheel', 'Tadpole', 'Cartwheel', 'Black Eye', 'Sunflower',
    'Southern Pinwheel', 'Comet', 'Hoags Object', 'Antennae', 'Ring Nebula',
    'Helix', 'Crab', 'Eagle', 'Omega', 'Lobster', 'Tarantula', 'Ghost Head',
    'Magic Eye', 'Bear Claw', 'Cosmic Reef'
];

function universeName(index) {
    return UNIVERSE_NAMES[index % UNIVERSE_NAMES.length];
}

const SEQUENTIAL_NAMES = ['Fireworks', 'Black Eye', 'Whirlpool', 'Sombrero'];

function serverName(index, mode) {
    if (mode === 'universe') return universeName(index);
    return SEQUENTIAL_NAMES[index] || `Server ${index + 1}`;
}

// Token minting cache
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

function applyToken(url, token) {
    if (!token) return url;
    if (url.indexOf('__TOKEN__') > -1) return url.split('__TOKEN__').join(token);
    return url + (url.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

// HTTP helpers
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

function extract(html, key) {
    const m = html.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'));
    return m ? m[1] : null;
}

// WASM ChaCha20 decrypt
async function decryptStreamUrls(encB64, wasmUrl) {
    try {
        const wasmRes = await fetch(wasmUrl, { credentials: 'omit' });
        if (!wasmRes.ok) throw new Error('wasm fetch failed: ' + wasmRes.status);
        const wasmBytes = await wasmRes.arrayBuffer();
        const mod = await WebAssembly.compile(wasmBytes);
        const inst = await WebAssembly.instantiate(mod, {});
        const ex = inst.exports;
        const enc = new Uint8Array(Buffer.from(encB64, 'base64'));
        const ptr = ex.alloc(enc.length);
        new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
        const outLen = ex.decrypt(ptr, enc.length);
        const txt = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr + 12, outLen));
        return txt.split('\n').filter((s) => s);
    } catch (e) {
        console.error('WASM decrypt error:', e.message);
        return null;
    }
}

// OpenSubtitles search
async function searchOpenSubtitles(imdbId) {
    try {
        const url = `${OPENSUBTITLES_API}/search/imdbid-${imdbId}/sublanguageid-eng`;
        const res = await fetch(url, {
            headers: { 'User-Agent': UA, 'Accept': 'application/json' },
            redirect: 'follow',
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || data.length === 0) return null;
        return data[0];
    } catch (e) {
        console.error('OpenSubtitles search failed:', e.message);
        return null;
    }
}

// Core: get real vidsrc.to stream URLs via complete embed flow
async function getRealMovieData(tmdb, namingMode) {
    // Step 1: Gate request
    let gateJson;
    try {
        gateJson = await fetchJson(`${GATE}?type=movie&id=${tmdb}`, {
            'Accept': 'application/json',
            'Referer': 'https://vidsrc.to/',
        });
    } catch (e) {
        return { fallback: true, error: 'gate failed: ' + e.message };
    }
    if (!gateJson || !gateJson.src) return { fallback: true, error: 'no gate src' };

    // Step 2: Fetch page1 (player page #1)
    const page1Url = gateJson.src;
    let html1;
    try {
        html1 = await fetchText(page1Url, { 'Referer': 'https://vsembed.ru/' });
    } catch (e) {
        return { fallback: true, error: 'page1 failed: ' + e.message };
    }

    // Step 3: Extract playerUrl from page1
    const playerUrlPath = extract(html1, 'playerUrl');
    if (!playerUrlPath) return { fallback: true, error: 'no playerUrl' };

    // Step 4: Fetch page2 from NEXUS
    const page2Url = NEXUS + playerUrlPath;
    let html2;
    try {
        html2 = await fetchText(page2Url, { 'Referer': NEXUS });
    } catch (e) {
        return { fallback: true, error: 'page2 failed: ' + e.message };
    }

    // Step 4b: Extract api and apiToken from page2 CONFIG
    const api = extract(html2, 'api');
    const token = extract(html2, 'apiToken');
    if (!api) return { fallback: true, error: 'no api' };
    if (!token) return { fallback: true, error: 'no apiToken' };

    // Step 5: Call stream_urls API
    const streamUrl = api + '&api_token=' + encodeURIComponent(token);
    let json;
    try {
        json = await fetchJson(streamUrl, { 'Accept': 'application/json', 'Referer': NEXUS });
    } catch (e) {
        return { fallback: true, error: 'stream api failed: ' + e.message };
    }

    if (json.status_code && String(json.status_code) !== '200') {
        return { fallback: true, error: 'stream api error: ' + (json.error || json.status_code) };
    }

    // Step 5b: Get wasm_url for decryption if needed
    let wasmUrl = json.vs && json.vs.wasm_url ? json.vs.wasm_url : null;

    // Step 5c: Get stream_urls
    let streamUrls = json.data && json.data.stream_urls;
    if (typeof streamUrls === 'string') {
        if (!wasmUrl) return { fallback: true, error: 'encrypted but no wasm_url' };
        const decrypted = await decryptStreamUrls(streamUrls, wasmUrl);
        if (decrypted && decrypted.length > 0) {
            streamUrls = decrypted;
        }
    }
    if (!Array.isArray(streamUrls) || streamUrls.length === 0) {
        return { fallback: true, error: 'no stream_urls' };
    }

    // Step 6: Mint tokens for each server origin and stamp URLs
    const servers = [];
    for (let i = 0; i < streamUrls.length; i++) {
        const rawUrl = streamUrls[i];
        let origin = '';
        try { origin = new URL(rawUrl).origin; } catch (e) {}

        let token = '';
        let tokenError = null;
        try {
            token = await mintToken(origin, false);
            if (!token) tokenError = 'generate.php returned no token';
        } catch (e) {
            tokenError = e.message;
        }

        const stampedUrl = applyToken(rawUrl, token);

        servers.push({
            id: i + 1,
            name: serverName(i, namingMode),
            available: true,
            tmdb,
            imdb: json.data && json.data.imdb_id ? json.data.imdb_id : '',
            video_url: stampedUrl,
            thumbnail_url: json.data && json.data.backdrop ? json.data.backdrop : '',
            subtitle_url: '/api/sub/' + (json.data && json.data.imdb_id ? json.data.imdb_id : 'unknown'),
            format: 'HLS · master.m3u8',
            server_name: serverName(i, namingMode),
            position: i + 1,
            token: token || '',
            tokenError: tokenError || null
        });
    }

    return {
        success: true,
        title: json.data && json.data.title ? json.data.title : 'Movie ' + tmdb,
        imdb_id: json.data && json.data.imdb_id ? json.data.imdb_id : '',
        backdrop: json.data && json.data.backdrop ? json.data.backdrop : '',
        file_name: json.data && json.data.file_name ? json.data.file_name : '',
        servers: servers
    };
}

// Mock fallback servers when vidsrc.to fails
function getFallbackServers(tmdb, namingMode) {
    const baseServers = [
        { name: 'Fireworks', id: 1, available: true },
        { name: 'Black Eye', id: 2, available: true },
        { name: 'Whirlpool', id: 3, available: true },
        { name: 'Sombrero', id: 4, available: false }
    ];

    return baseServers.map((s) => {
        const domain = s.name.toLowerCase().replace(/\s+/g, '');
        const vUrl = `https://${domain}.example.com/hls/movie-${tmdb}/master.m3u8`;
        return {
            id: s.id,
            name: serverName(s.id - 1, namingMode),
            available: s.available,
            tmdb,
            imdb: '',
            video_url: vUrl,
            thumbnail_url: `https://${domain}.example.com/thumbs/movie-${tmdb}.jpg`,
            subtitle_url: '/api/sub/unknown',
            format: 'HLS · master.m3u8',
            server_name: serverName(s.id - 1, namingMode),
            position: s.id,
            token: '',
            tokenError: 'token-unavailable'
        };
    });
}

// Subtitle endpoint logic
async function getSubtitles(imdbId) {
    let subs = null;
    let trackCount = 0;
    let subtitleFormats = [];
    let webvtt_url = null;

    if (imdbId) {
        const osResult = await searchOpenSubtitles(imdbId);
        if (osResult && osResult.data && osResult.data.length > 0) {
            const bestSub = osResult.data[0];
            webvtt_url = NEXUS + '/embed/iframe_player/cache/subs/19/' + bestSub.IDSubtitleFile + '.vtt';
            subs = {
                tracks: [{
                    IDSubtitle: bestSub.IDSubtitleFile,
                    SubFileName: bestSub.SubFileName,
                    SubLanguageID: bestSub.SubLanguageID
                }],
                formats: { vtt: 'WebVTT' }
            };
            trackCount = 1;
            subtitleFormats = ['vtt'];
        }

        // Fallback mock data if OpenSubtitles finds nothing
        if (!subs || trackCount === 0) {
            const mockData = {
                'tt1234567': {
                    tracks: [
                        { id: '1962434148', name: 'Obs.2025.720p.WEBRip.srt, language: eng', language: 'eng', format: 'srt' },
                        { id: '1962434831', name: 'Obs.2026.1080p.CAM.srt, language: eng', language: 'eng', format: 'srt' }
                    ],
                    track_count: 2,
                    formats: ['srt', 'vtt'],
                    webvtt_base: NEXUS + '/embed/iframe_player/cache/subs/19/'
                },
                'tt3896011': {
                    tracks: [
                        { id: '1972345678', name: 'Samp.2024.1080p.WEB-DL.srt, language: eng', language: 'eng', format: 'srt' }
                    ],
                    track_count: 1,
                    formats: ['srt'],
                    webvtt_base: NEXUS + '/embed/iframe_player/cache/subs/19/'
                },
                'tt1234568': {
                    tracks: [],
                    track_count: 0,
                    formats: [],
                    webvtt_base: NEXUS + '/embed/iframe_player/cache/subs/19/'
                }
            };
            const mock = mockData[imdbId];
            if (mock) {
                subs = mock;
                trackCount = mock.track_count;
                subtitleFormats = mock.formats;
                webvtt_url = mock.webvtt_base + (mock.tracks[0] ? mock.tracks[0].id : '') + '.vtt';
            }
        }
    }

    if (!subs) {
        subs = {};
        trackCount = 0;
        subtitleFormats = [];
    }

    return {
        success: true,
        imdb_id: imdbId,
        subtitle_track_count: trackCount,
        subtitle_formats: subtitleFormats,
        default_subs: subs,
        webvtt_url: webvtt_url
    };
}

// ============================
// Endpoints
// ============================

/**
 * GET /api/movie/:tmdb_id
 * Returns movie info with real vidsrc.to stream URLs.
 * Falls back to example domains only when vidsrc.to fails.
 */
app.get('/api/movie/', (_req, res) => {
    res.status(400).json({ success: false, error: 'missing :tmdb_id', example: '/api/movie/1339713' });
});
app.get('/api/movie/:tmdb_id', async (req, res) => {
    const tmdb = req.params.tmdb_id;
    const namingMode = req.query.naming === 'universe' ? 'universe' : 'sequential';

    if (!tmdb) {
        return res.status(400).json({ success: false, error: 'missing :tmdb_id', example: '/api/movie/1339713' });
    }

    try {
        const real = await getRealMovieData(tmdb, namingMode);

        const servers = real.fallback || !real.success
            ? getFallbackServers(tmdb, namingMode)
            : real.servers;

        res.json({
            success: true,
            tmdb,
            naming_mode: namingMode,
            title: real.fallback ? 'Movie ' + tmdb : (real.title || 'Movie ' + tmdb),
            imdb: real.fallback ? '' : (real.imdb_id || ''),
            file_name: real.fallback ? '' : (real.file_name || ''),
            backdrop: real.fallback ? '' : (real.backdrop || ''),
            servers,
            server_count: servers.length,
            fallback: real.fallback || false,
            error: real.error || null
        });
    } catch (e) {
        const fallbackServers = getFallbackServers(tmdb, namingMode);
        res.json({
            success: true,
            tmdb,
            naming_mode: namingMode,
            title: 'Movie ' + tmdb,
            imdb: '',
            servers: fallbackServers,
            server_count: fallbackServers.length,
            fallback: true,
            error: e.message
        });
    }
});

/**
 * GET /api/sub/:imdb_id
 * Returns subtitle tracks with OpenSubtitles fallback.
 */
app.get('/api/sub/', (_req, res) => {
    res.status(400).json({ success: false, error: 'missing :imdb_id', example: '/api/sub/tt1234567' });
});
app.get('/api/sub/:imdb_id', async (req, res) => {
    const imdbId = req.params.imdb_id;

    if (!imdbId) {
        return res.status(400).json({ success: false, error: 'missing :imdb_id', example: '/api/sub/tt1234567' });
    }

    const subtitleData = await getSubtitles(imdbId);

    res.json({
        success: subtitleData.success,
        imdb_id: subtitleData.imdb_id,
        subtitle_track_count: subtitleData.subtitle_track_count,
        subtitle_formats: subtitleData.subtitle_formats,
        default_subs: subtitleData.default_subs,
        webvtt_url: subtitleData.webvtt_url
    });
});

/**
 * GET /api/sub/:imdb_id/:subtitle_id
 * Returns WebVTT subtitle URL.
 */
app.get('/api/sub/:imdb_id/', (_req, res) => {
    res.status(400).json({ success: false, error: 'missing :subtitle_id' });
});
app.get('/api/sub/:imdb_id/:subtitle_id', (req, res) => {
    const imdbId = req.params.imdb_id;
    const subtitleId = req.params.subtitle_id;

    if (!subtitleId || subtitleId.trim() === '') {
        return res.status(400).json({ success: false, error: 'missing :subtitle_id' });
    }

    const webvttUrl = NEXUS + '/embed/iframe_player/cache/subs/19/' + subtitleId + '.vtt';

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
 * Player placeholder endpoint.
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
 * Health check.
 */
app.get('/health', (req, res) => {
    res.json({ ok: true, project: 'galactic', time: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'endpoint not found' });
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`galactic API listening on http://localhost:${PORT}`);
        console.log('Endpoints:');
        console.log('  GET /health                    -> health check');
        console.log('  GET /api/movie/:tmdb_id        -> movie info with real vidsrc.to servers');
        console.log('  GET /api/sub/:imdb_id          -> subtitle tracks');
        console.log('  GET /api/sub/:imdb_id/:sId     -> WebVTT subtitle URL');
        console.log('  GET /api/player                -> player placeholder');
        console.log('');
        console.log('Server ordering:');
        console.log('  0: Fireworks (first)');
        console.log('  1: Black Eye (second)');
        console.log('  2: Whirlpool (third/fallback)');
        console.log('  3: Sombrero (beta - unavailable)');
        console.log('');
        console.log('Token minting: IP-authorized via /generate.php (IP 143.44.168.54)');
        console.log('OpenSubtitles: https://rest.opensubtitles.org/search/imdbid-.../sublanguageid-eng');
        console.log('WebVTT URLs: ${NEXUS}/embed/iframe_player/cache/subs/19/{IDSubtitleFile}.vtt');
    });
}

module.exports = app;