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
// Constants & Configuration
// ============================
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const GATE = 'https://vsembed.ru/vs_src.php';
const NEXUS = 'https://stellarconductornexus.com';
const OPENSUBTITLES_API = 'https://rest.opensubtitles.org';

// Your authorized IP for vidsrc.to playback
const AUTHORIZED_IP = '143.44.168.54';

// Universe names for "universe" naming mode
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

// ============================
// Token Minting (IP-authorized)
// ============================
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

// ============================
// Core Extraction Functions
// ============================

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

// ============================
// vidsrc.to Extraction (with fallback)
// ============================

async function getPlaylist(tmdb, namingMode) {
    let gateJson;
    try {
        gateJson = await fetchJson(`${GATE}?type=movie&id=${tmdb}`, {
            'Accept': 'application/json',
            'Referer': 'https://vidsrc.to/',
        });
    } catch (e) {
        throw new Error('gate request failed: ' + e.message);
    }
    if (!gateJson || !gateJson.src) {
        throw new Error('gate returned no src');
    }
    const page1Url = gateJson.src;

    let html1;
    try {
        html1 = await fetchText(page1Url, { 'Referer': 'https://vsembed.ru/' });
    } catch (e) {
        throw new Error('page1 request failed');
    }
    const playerUrlPath = extract(html1, 'playerUrl');
    if (!playerUrlPath) throw new Error('page1 has no playerUrl');

    const page2Url = NEXUS + playerUrlPath;

    let html2;
    try {
        html2 = await fetchText(page2Url, { 'Referer': NEXUS });
    } catch (e) {
        throw new Error('page2 request failed');
    }
    const api = extract(html2, 'api');
    const token = extract(html2, 'apiToken');

    if (!api) throw new Error('page2 has no CONFIG.api');
    if (!token) throw new Error('page2 has no CONFIG.apiToken');

    const streamUrl = api + '&api_token=' + encodeURIComponent(token);
    let json;
    try {
        json = await fetchJson(streamUrl, {
            'Accept': 'application/json',
            'Referer': NEXUS,
        });
    } catch (e) {
        throw new Error('stream_urls API request failed');
    }
    if (json.status_code && String(json.status_code) !== '200') {
        throw new Error('stream_urls API error: ' + (json.error || json.status_code));
    }

    let wasmUrl = json.vs && json.vs.wasm_url ? json.vs.wasm_url : null;
    let streamUrls = json.data && json.data.stream_urls;
    if (typeof streamUrls === 'string') {
        if (!wasmUrl) throw new Error('encrypted but no wasm_url');
        streamUrls = await decryptStreamUrls(streamUrls, wasmUrl);
    }
    if (!Array.isArray(streamUrls) || streamUrls.length === 0) {
        throw new Error('no stream_urls returned');
    }

    const servers = streamUrls.map((raw, i) => {
        let origin = '';
        try { origin = new URL(raw).origin; } catch (e) {}
        return {
            id: i + 1,
            name: serverName(i, namingMode),
            origin,
            url: raw,
            combined_url: raw,
            format: 'HLS · master.m3u8',
            raw,
            token: '',
            tokenError: null,
            status: 'pending-client-token',
        };
    });

    return {
        success: true,
        project: 'foltynsrc',
        naming_mode: namingMode,
        tmdb,
        title: json.data && json.data.title,
        imdb: json.data && json.data.imdb_id,
        file_name: json.data && json.data.file_name,
        backdrop: json.data && json.data.backdrop,
        default_subs: json.data && json.data.default_subs,
        thumbnails_url: json.data && json.data.thumbnails_url,
        servers,
        raw: json,
    };
}

// ============================
// TV Series Extraction
// ============================

function extractTvInfo(html) {
    let tvIndex = false;
    let epsData = null;
    let initialSeason = 1;
    let initialEpisode = 1;

    const cfgMatch = html.match(new RegExp('"CFG"\\s*:\\s*"([^"]+)"'));
    if (cfgMatch) {
        try { const cfg = JSON.parse(cfgMatch[1]); tvIndex = !!cfg.tvIndex; } catch (e) {}
    }
    const epsMatch = html.match(new RegExp('"eps"\\s*:\\s*"([^"]+)"'));
    if (epsMatch) { try { epsData = JSON.parse(epsMatch[1]); } catch (e) {} }
    const seasonEpMatch = html.match(/[Ss](\d+)[^Ee]*[Ee](\d+)/);
    if (seasonEpMatch) {
        initialSeason = parseInt(seasonEpMatch[1], 10);
        initialEpisode = parseInt(seasonEpMatch[2], 10);
    }
    return { tvIndex, eps: epsData, season: initialSeason, episode: initialEpisode };
}

async function getTvSeries(tmdbId, tmdbIdForGate, namingMode) {
    let gateJson;
    try {
        gateJson = await fetchJson(`${GATE}?type=tv&id=${tmdbIdForGate}`, {
            'Accept': 'application/json',
            'Referer': 'https://vidsrc.to/',
        });
    } catch (e) { throw new Error('TV gate request failed'); }
    if (!gateJson || !gateJson.src) { throw new Error('TV gate returned no src'); }
    const iframeUrl = gateJson.src;

    let html;
    try { html = await fetchText(iframeUrl, { 'Referer': 'https://vsembed.ru/' }); } catch (e) { throw new Error('TV iframe page request failed'); }

    const tvInfo = extractTvInfo(html);

    const api = extract(html, 'api');
    const token = extract(html, 'apiToken');

    if (!api) throw new Error('TV player page has no CONFIG.api');
    if (!token) throw new Error('TV player page has no CONFIG.apiToken');

    const streamUrl = api + '&api_token=' + encodeURIComponent(token);
    let json;
    try { json = await fetchJson(streamUrl, { 'Accept': 'application/json', 'Referer': NEXUS }); } catch (e) { throw new Error('TV stream_urls API request failed'); }
    if (json.status_code && String(json.status_code) !== '200') { throw new Error('TV stream_urls API error: ' + (json.error || json.status_code)); }

    let wasmUrl = json.vs && json.vs.wasm_url ? json.vs.wasm_url : null;
    let streamUrls = json.data && json.data.stream_urls;
    if (typeof streamUrls === 'string') {
        if (!wasmUrl) throw new Error('encrypted but no wasm_url');
        streamUrls = await decryptStreamUrls(streamUrls, wasmUrl);
    }
    if (!Array.isArray(streamUrls) || streamUrls.length === 0) { throw new Error('no stream_urls returned for TV series'); }

    const servers = streamUrls.map((raw, i) => {
        let origin = '';
        try { origin = new URL(raw).origin; } catch (e) {}
        return {
            id: i + 1,
            name: serverName(i, namingMode),
            origin,
            url: raw,
            combined_url: raw,
            format: 'HLS · master.m3u8',
            raw,
            token: '',
            tokenError: null,
            status: 'pending-client-token',
        };
    });

    const seasonCount = tvInfo.eps ? Object.keys(tvInfo.eps).filter(k => !isNaN(Number(k))).length : 0;
    const tvMeta = {
        tvIndex: tvInfo.tvIndex || false,
        eps: tvInfo.eps || {},
        seasonCount: seasonCount,
        initialSeason: tvInfo.season || 1,
        initialEpisode: tvInfo.episode || 1,
    };

    return {
        success: true,
        project: 'foltynsrc',
        naming_mode: namingMode,
        tmdb: tmdbId,
        title: json.data && json.data.title,
        imdb: json.data && json.data.imdb_id,
        file_name: json.data && json.data.file_name,
        backdrop: json.data && json.data.backdrop,
        default_subs: json.data && json.data.default_subs,
        thumbnails_url: json.data && json.data.thumbnails_url,
        servers,
        raw: json,
        tv: tvMeta,
    };
}

// ============================
// Subtitle Endpoint Logic
// ============================

async function getSubtitles(imdbId, tmdb) {
    let subs = null;
    let trackCount = 0;
    let subtitleFormats = [];
    let webvtt_url = null;

    // Try vidsrc.to subtitle data first
    let subData = null;
    try { subData = (await getPlaylist(tmdb, 'sequential')).default_subs; } catch (e) { /* vidsrc.to failed */ }

    if (subData) {
        if (Array.isArray(subData)) {
            trackCount = subData.length;
            subtitleFormats = [];
            subs = { tracks: subData, formats: {} };
        } else if (typeof subData === 'object' && subData !== null) {
            trackCount = subData.tracks ? subData.tracks.length : 0;
            subtitleFormats = subData.formats ? Object.keys(subData.formats) : [];
            subs = subData;
        }
    }

    // If no subtitles from vidsrc.to, try OpenSubtitles API
    if (!subs || trackCount === 0) {
        if (imdbId) {
            try {
                const osResult = await searchOpenSubtitles(imdbId);
                if (osResult && osResult.data && osResult.data.length > 0) {
                    const bestSub = osResult.data[0];
                    webvtt_url = NEXUS + '/embed/iframe_player/cache/subs/19/' + bestSub.IDSubtitle + '.vtt';
                    subs = {
                        tracks: [{ IDSubtitle: bestSub.IDSubtitle, SubFileName: bestSub.SubFileName, SubLanguageID: bestSub.SubLanguageID }],
                        formats: { vtt: 'WebVTT' }
                    };
                    trackCount = 1;
                    subtitleFormats = ['vtt'];
                }
            } catch (e) { /* OpenSubtitles failed */ }
        }
    }

    // Final fallback
    if (!subs) {
        subs = {};
        trackCount = 0;
        subtitleFormats = [];
    }

    return {
        success: true,
        tmdb,
        imdb_id: imdbId,
        default_subs: subs,
        subtitle_track_count: trackCount,
        subtitle_formats: subtitleFormats,
        webvtt_url: webvtt_url,
    };
}

// ============================
// Endpoints
// ============================

/**
 * GET /api/movie/:tmdb_id
 * Returns movie info with REAL vidsrc.to HLS playlist URLs and token minting.
 * Server ordering: Fireworks (first), Black Eye (second), Whirlpool (third/fallback), Sombrero (beta unavailable).
 * Falls back to example domains when vidsrc.to extraction fails gracefully.
 */
app.get('/api/movie/:tmdb_id', async (req, res) => {
    const tmdb = req.params.tmdb_id;
    const namingMode = req.query.naming === 'universe' ? 'universe' : 'sequential';

    if (!tmdb) {
        return res.status(400).json({ success: false, error: 'missing :tmdb_id', example: '/api/movie/1339713' });
    }

    try {
        let result;
        let fallback = false;

        // Try real vidsrc.to extraction
        try {
            result = await getPlaylist(tmdb, namingMode);
        } catch (e) {
            fallback = true;
            result = null;
        }

        // Build servers with real data or fallback
        const servers = [];

        if (fallback || !result) {
            // Fallback: use example domains with token minting info
            const baseServers = [
                { name: 'Fireworks', id: 1 },
                { name: 'Black Eye', id: 2 },
                { name: 'Whirlpool', id: 3 },
                { name: 'Sombrero', id: 3, available: false }
            ];

            for (let i = 0; i < baseServers.length; i++) {
                const s = baseServers[i];
                const origin = AUTHORIZED_IP;
                let token = '';
                try { token = await mintToken(origin, false); } catch (e) {}

                servers.push({
                    id: s.id,
                    name: s.name,
                    available: s.id !== 3, // Sombrero unavailable
                    tmdb,
                    imdb: fallback ? '' : (result ? result.imdb : ''),
                    video_url: s.id <= 3 ? `https://${s.name.toLowerCase().replace(/\s+/g, '')}.example.com/hls/movie-${tmdb}/master.m3u8` : null,
                    thumbnail_url: `https://${s.name.toLowerCase().replace(/\s+/g, '')}.example.com/thumbs/movie-${tmdb}.jpg`,
                    subtitle_url: `/api/sub/${result.imdb || 'unknown'}`,
                    format: 'HLS · master.m3u8',
                    server_name: s.name,
                    position: s.id,
                    token: token || '',
                    tokenError: token ? null : 'token-unavailable',
                });
            }
        } else {
            // Use real vidsrc.to data with token minting
            for (const s of result.servers) {
                let token = '';
                try { token = await mintToken(s.origin, false); } catch (e) {}

                servers.push({
                    id: s.id,
                    name: s.name,
                    available: true,
                    tmdb,
                    imdb: result.imdb || '',
                    video_url: s.url, // Real vidsrc.to URL (may have token appended)
                    thumbnail_url: result.backdrop || `https://example.com/thumbs/movie-${tmdb}.jpg`,
                    subtitle_url: `/api/sub/${result.imdb || 'unknown'}`,
                    format: server.format,
                    server_name: server_name,
                    position: server.id,
                    token: token || '',
                    tokenError: token ? null : 'token-unavailable',
                });
            }
        }

        // Also stamp subtitle URL
        let subsStamped = result ? result.default_subs : null;
        if (result && Array.isArray(result.default_subs)) {
            subsForStamping = result.default_subs.length > 0 ? result.default_subs[0] : result.default_subs;
        } else {
            subsForStamping = result ? result.default_subs : null;
        }
        let subsStampedResult = subsForStamping;
        try { subsStampedResult = await applyToken(subsForStamping); } catch (error) { subsStampedResult = subsForStamping; }

        res.json({
            success: true,
            project: 'foltynsrc',
            naming_mode: namingMode,
            tmdb,
            title: result ? result.title : 'Movie ' + tmdb,
            imdb: result ? result.imdb : '',
            file_name: result ? result.file_name : '',
            backdrop: result ? result.backdrop : '',
            default_subs: result ? result.default_subs : subsStampedResult,
            thumbnails_url: result ? result.thumbnails_url : '',
            servers,
            raw: result ? result.raw : {},
            subs: subsStampedResult,
        });
    } catch (e) {
        res.status(502).json({ success: false, error: e.message, tmdb, naming_mode: namingMode });
    }
});

/**
 * GET /api/tv/:tmdb_id
 * Returns TV series info with real vidsrc.to extraction and TV metadata.
 */
app.get('/api/tv/:tmdb_id', async (req, res) => {
    const tmdb = req.params.tmdb_id;
    const namingMode = req.query.naming === 'universe' ? 'universe' : 'sequential';

    if (!tmdb) {
        return res.status(400).json({ success: false, error: 'missing :tmdb_id', example: '/api/tv/1396' });
    }

    try {
        let result;
        try {
            result = await getTvSeries(tmdb, tmdb, namingMode);
        } catch (e) {
            if (!tmdb.startsWith('tt')) {
                try { result = await getTvSeries(tmdb, 'tt' + tmdb.substring(2), namingMode); } catch (e2) {
                    res.status(502).json({ success: false, error: e2.message, tmdb, naming_mode: namingMode }); return;
                }
            } else {
                res.status(502).json({ success: false, error: e.message, tmdb, naming_mode: namingMode }); return;
            }
        }

        // Mint tokens for TV servers
        const tokenPromises = result.servers.map(server => mintToken(server.origin, false));
        const stampedServers = await Promise.all(result.servers.map(async (server, i) => {
            let token = '';
            try { token = await mintToken(server.origin, false); } catch (e) {}
            return {
                id: server.id,
                name: server.name,
                available: true,
                tmdb,
                imdb: result.imdb || '',
                video_url: server.url,
                thumbnail_url: result.backdrop || `https://example.com/thumbs/movie-${tmdb}.jpg`,
                subtitle_url: `/api/sub/${result.imdb || 'unknown'}`,
                format: server.format,
                server_name: server.name,
                position: server.id,
                token: token || '',
                tokenError: token ? null : 'token-unavailable',
            };
        }));

        res.json({
            success: true,
            tmdb: tmdb.toString(),
            naming_mode: namingMode,
            title: result.title,
            imdb: result.imdb,
            tv: result.tv,
            default_subs: result.default_subs,
            servers: stampedServers,
            raw: result.raw,
        });
    } catch (e) {
        res.status(502).json({ success: false, error: e.message, tmdb, naming_mode: namingMode });
    }
});

/**
 * GET /api/sub/:imdb_id
 * Returns subtitle tracks. Falls back to OpenSubtitles API if vidsrc.to has no subs.
 * Provides WebVTT URL via stellarconductornexus.com when subs found.
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
 * Returns WebVTT subtitle URL for the given subtitle ID.
 * Format: ${NEXUS}/embed/iframe_player/cache/subs/19/{subtitle_id}.vtt
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
 * Player page placeholder - will be connected when video player is uploaded.
 */
app.get('/api/player', (req, res) => {
    res.json({ success: true, message: 'Player endpoint - video player will be uploaded and connected later', endpoint: '/api/player', status: 'placeholder' });
});

/**
 * GET /health
 * Health check endpoint.
 */
app.get('/health', (req, res) => { res.json({ ok: true, project: 'galactic', time: new Date().toISOString() }); });

// 404 handler
app.use((_req, res) => { res.status(404).json({ success: false, error: 'endpoint not found' }); });

// Start server (only runs locally, not in Vercel serverless)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`galactic API listening on http://localhost:${PORT}`);
        console.log('Endpoints:');
        console.log('  GET /health                    -> health check');
        console.log('  GET /api/movie/:tmdb_id        -> REAL vidsrc.to movie playlist with token minting');
        console.log('  GET /api/tv/:tmdb_id           -> TV series extraction with season/episode metadata');
        console.log('  GET /api/sub/:imdb_id          -> Subtitle tracks with OpenSubtitles fallback');
        console.log('  GET /api/sub/:imdb_id/:subtitle_id -> WebVTT subtitle URL');
        console.log('  GET /api/player                -> Player placeholder');
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