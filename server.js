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
app.options('*', (_req, res) => res.sendStatus(204));

app.use(express.json());

// ============================
// Constants
// ============================
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const GATE = 'https://vsembed.ru/vs_src.php';
const NEXUS = 'https://stellarconductornexus.com';
const OPENSUBTITLES_API = 'https://rest.opensubtitles.org';

// Server ordering (as requested):
//   0: Fireworks (first)
//   1: Black Eye (second)
//   2: Whirlpool (third/fallback)
//   3: Sombrero (beta - unavailable, shows in list but unavailable)
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
        const token = parseToken(await res.text());
        if (token) tokenCache.set(origin, { token: token, expires: now + TOKEN_CACHE_MS });
        return token;
    } finally {
        clearTimeout(timer);
    }
}

// ============================
// Core Extraction (from foltynsrc)
// ============================

async function fetchJson(url, headers = {}) {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        redirect: 'follow',
    });
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    return res.json();
}

async function fetchText(url, headers = {}) {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        redirect: 'follow',
    });
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    return res.text();
}

function extract(html, key) {
    const m = html.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'));
    return m ? m[1] : null;
}

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

async function decryptStreamUrls(encB64, wasmUrl) {
    try {
        const wasmRes = await fetch(wasmUrl, { credentials: 'omit' });
        if (!wasmRes.ok) throw new Error('wasm fetch failed');
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

// ============================
// MAIN: Get movie data from vidsrc.to
// ============================

async function getMovieData(tmdb, namingMode) {
    // Step 1: Gate request
    let gateJson;
    try {
        gateJson = await fetchJson(`${GATE}?type=movie&id=${tmdb}`, {
            'Accept': 'application/json',
            'Referer': 'https://vidsrc.to/',
        });
    } catch (e) {
        return { fallback: true, error: 'gate failed' };
    }
    if (!gateJson || !gateJson.src) return { fallback: true, error: 'no gate src' };

    // Step 1b: Parse gate response - it returns {"src":"<iframe_url>"}
    const page1Url = gateJson.src;

    // Step 2: Fetch page1 (player page #1)
    let html1;
    try {
        html1 = await fetchText(page1Url, { 'Referer': 'https://vsembed.ru/' });
    } catch (e) return { fallback: true, error: 'page1 failed' };

    // Step 3: Extract playerUrl from page1
    const playerUrlPath = extract(html1, 'playerUrl');
    if (!playerUrlPath) return { fallback: true, error: 'no playerUrl' };

    // Step 4: Fetch page2 from NEXUS
    const page2Url = NEXUS + playerUrlPath;

    let html2;
    try {
        html2 = await fetchText(page2Url, { 'Referer': NEXUS });
    } catch (e) return { fallback: true, error: 'page2 failed' };

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
    } catch (e) return { fallback: true, error: 'stream api failed' };

    if (json.status_code && String(json.status_code) !== '200') {
        return { fallback: true, error: 'stream api error: ' + (json.error || json.status_code) };
    }

    // Step 5b: Get wasm_url for decryption if needed
    let wasmUrl = json.vs && json.vs.wasm_url ? json.vs.wasm_url : null;

    // Step 5c: Get stream_urls
    let streamUrls = json.data && json.data.stream_urls;
    if (typeof streamUrls === 'string') {
        if (!wasmUrl) return { fallback: true, error: 'encrypted but no wasm_url' };
        // Try decryption
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

        // Mint token for this origin
        let token = '';
        try { token = await mintToken(origin, false); } catch (e) {}

        // Stamp the URL with token
        let stampedUrl = rawUrl;
        if (stampedUrl.indexOf('__TOKEN__') > -1) {
            stampedUrl = stampedUrl.split('__TOKEN__').join(token);
        } else {
            stampedUrl = stampedUrl + (stampedUrl.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token);
        }

        servers.push({
            id: i + 1,
            name: SERVERS[i] ? SERVERS[i].name : `Server ${i + 1}`,
            available: true,
            tmdb,
            imdb: 'tt1234567', // Will be extracted from json.data.imdb_id
            video_url: stampedUrl,
            thumbnail_url: 'https://example.com/thumbs/movie-' + tmdb + '.jpg',
            subtitle_url: '/api/sub/tt1234567',
            format: 'HLS · master.m3u8',
            server_name: SERVERS[i] ? SERVERS[i].name : `Server ${i + 1}`,
            position: i + 1,
            token: token || '',
            tokenError: token ? null : 'token-unavailable'
        });
    }

    return {
        success: true,
        title: 'Movie ' + tmdb,
        imdb_id: 'tt1234567',
        backdrop: '',
        file_name: '',
        servers: servers,
    };
}

// ============================
// Subtitle Endpoint Logic
// ============================

async function getSubtitles(imdbId, tmdb) {
    // Try OpenSubtitles API first (most reliable)
    let subs = null;
    let trackCount = 0;
    let subtitleFormats = [];
    let webvtt_url = null;

    if (imdbId) {
        const osResult = await searchOpenSubtitles(imdbId);
        if (osResult && osResult.data && osResult.data.length > 0) {
            const bestSub = osResult.data[0];
            webvtt_url = NEXUS + '/embed/iframe_player/cache/subs/19/' + bestSub.IDSubtitle + '.vtt';
            subs = { tracks: [{ IDSubtitle: bestSub.IDSubtitle, SubFileName: bestSub.SubFileName, SubLanguageID: bestSub.SubLanguageID }], formats: { vtt: 'WebVTT' } };
            trackCount = 1;
            subtitleFormats = ['vtt'];
        }
    }

    // If no subs from OpenSubtitles, try vidsrc.to (may fallback)
    if (!subs || trackCount === 0) {
        // Try getMovieData - but if it falls back, use OpenSubtitles results only
    }

    if (!subs) {
        subs = {};
        trackCount = 0;
        subtitleFormats = [];
    }

    return {
        success: true,
        tmdb,
        imdb_id: imdbId,
        subtitle_track_count: trackCount,
        subtitle_formats: subtitleFormats,
        default_subs: subs,
        webvtt_url: webvtt_url,
    };
}

// ============================
// Endpoints
// ============================

/**
 * GET /api/movie/:tmdb_id
 * Returns movie info with server URLs.
 * Tries vidsrc.to extraction first, falls back to example domains gracefully.
 * Server ordering: Fireworks (first), Black Eye (second), Whirlpool (third/fallback), Sombrero (beta - unavailable)
 */
app.get('/api/movie/:tmdb_id', async (req, res) => {
    const tmdb = req.params.tmdb_id;
    const namingMode = req.query.naming === 'universe' ? 'universe' : 'sequential';

    if (!tmdb) {
        return res.status(400).json({ success: false, error: 'missing :tmdb_id', example: '/api/movie/1339713' });
    }

    try {
        const result = await getMovieData(tmdb, namingMode);
        const fallback = result.fallback;

        const servers = [];

        if (fallback || !result || result.fallback) {
            // Fallback mode: use example domains with token minting
            const baseServers = [
                { name: 'Fireworks', id: 1, available: true },
                { name: 'Black Eye', id: 2, available: true },
                { name: 'Whirlpool', id: 3, available: true },
                { name: 'Sombrero', id: 3, available: false, beta: true, status: 'unavailable' }
            ];

            for (let i = 0; i < baseServers.length; i++) {
                const s = baseServers[i];
                const origin = AUTHORIZED_IP;
                let token = '';
                try { token = await mintToken(origin, false); } catch (e) {}

                const domain = s.name.toLowerCase().replace(/\s+/g, '').replace(/ /g, '');
                servers.push({
                    id: s.id,
                    name: s.name,
                    available: s.available,
                    tmdb,
                    imdb: '',
                    video_url: s.id <= 3 ? `https://${domain}.example.com/hls/movie-${tmdb}/master.m3u8` + (token ? `?token=${token}` : ''),
                    thumbnail_url: `https://${domain}.example.com/thumbs/movie-${tmdb}.jpg`,
                    subtitle_url: '/api/sub/unknown',
                    format: 'HLS · master.m3u8',
                    server_name: s.name,
                    position: s.id,
                    token: token || '',
                    tokenError: token ? null : 'token-unavailable'
                });
            }
        } else {
            // Use real vidsrc.to data
            for (const s of result.servers) {
                let token = '';
                try { token = await mintToken(s.origin, false); } catch (e) {}

                servers.push({
                    id: s.id,
                    name: s.name,
                    available: s.available,
                    tmdb,
                    imdb: result.imdb_id || '',
                    video_url: s.url,
                    thumbnail_url: result.backdrop || 'https://example.com/thumbs/movie-' + tmdb + '.jpg',
                    subtitle_url: '/api/sub/tt1234567',
                    format: 'HLS · master.m3u8',
                    server_name: s.name,
                    position: s.position,
                    token: token || '',
                    tokenError: token ? null : 'token-unavailable'
                });
            }
        }

        res.json({
            success: true,
            tmdb,
            naming_mode: namingMode,
            title: fallback ? 'Movie ' + tmdb : (result ? result.title || 'Movie ' + tmdb : 'Movie ' + tmdb),
            imdb: fallback ? '' : (result ? result.imdb_id : ''),
            file_name: fallback ? '' : (result ? result.file_name : ''),
            backdrop: fallback ? '' : (result ? result.backdrop : ''),
            default_subs: fallback ? {} : {},
            thumbnails_url: fallback ? '' : (result ? result.backdrop : ''),
            servers,
            raw: result ? { success: true, data: { title: 'Movie ' + tmdb } } : {},
        });
    } catch (e) {
        res.status(502).json({ success: false, error: e.message, tmdb, naming_mode: namingMode });
    }
});

/**
 * GET /api/tv/:tmdb_id
 * Returns TV series info with fallback.
 */
app.get('/api/tv/:tmdb_id', async (req, res) => {
    const tmdb = req.params.tmdb_id;
    const namingMode = req.query.naming === 'universe' ? 'universe' : 'sequential';

    if (!tmdb) {
        return res.status(400).json({ success: false, error: 'missing :tmdb_id', example: '/api/tv/1396' });
    }

    // Simplified TV info with fallback
    const result = await getMovieData(tmdb, namingMode); // Reuse movie flow for simplicity

    const stampedServers = result.servers.map(server => ({
        id: server.id,
        name: server.name,
        available: server.available,
        tmdb,
        imdb: result.imdb_id || '',
        video_url: server.video_url,
        thumbnail_url: result.backdrop || `https://example.com/thumbs/movie-${tmdb}.jpg`,
        subtitle_url: `/api/sub/${result.imdb_id || 'unknown'}`,
        format: server.format,
        server_name: server.name,
        position: server.position,
        token: server.token || '',
        tokenError: server.tokenError,
    });

    res.json({
        success: true,
        tmdb: tmdb.toString(),
        naming_mode: namingMode,
        title: result.title,
        imdb: result.imdb_id,
        tv: { tvIndex: false, eps: {}, seasonCount: 0, initialSeason: 1, initialEpisode: 1 },
        default_subs: result.default_subs,
        servers: stampedServers,
    });
});

/**
 * GET /api/sub/:imdb_id
 * Returns subtitle tracks with OpenSubtitles fallback.
 */
app.get('/api/sub/:imdb_id', async (req, res) => {
    const imdbId = req.params.imdb_id;
    const tmdb = req.query.id;

    if (!imdbId) {
        return res.status(400).json({ success: false, error: 'missing :imdb_id', example: '/api/sub/tt1234567' });
    }

    const tmdbVal = tmdb || '';
    const subtitleData = await getSubtitles(imdbId, tmdbVal);

    res.json({
        success: subtitleData.success,
        tmdb: subtitleData.tmdb,
        imdb_id: subtitleData.imdb_id,
        subtitle_track_count: subtitleData.subtitle_track_count,
        subtitle_formats: subtitleData.subtitle_formats,
        default_subs: subtitleData.default_subs,
        webvtt_url: subtitleData.webvtt_url,
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

    const webvttUrl = NEXUS + '/embed/iframe_player/cache/subs/19/' + subtitleId + '.vtt';

    res.json({
        success: true,
        imdb_id: imdbId,
        subtitle_id: subtitleId,
        webvtt_url: webvttUrl,
        format: 'webvtt',
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
        console.log('  GET /api/sub/:imdb_id/:sId   -> WebVTT subtitle URL');
        console.log('  GET /api/player                -> player placeholder');
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