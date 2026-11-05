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

function uName(index, mode) {
    if (mode === 'universe') return UNIVERSE_NAMES[index % UNIVERSE_NAMES.length];
    return `Server ${index + 1}`;
}

function sName(index, mode) {
    return uName(index, mode);
}

// Token minting (IP-authorized) - using unique variable names
const TOKEN_CACHE_MS = 4 * 60 * 1000;
const tCache = new Map();

function pToken(text) {
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

async function mToken(origin, force) {
    const now = Date.now();
    const hit = tCache.get(origin);
    if (!force && hit && hit.expires > now) return hit.token;
    const ac = new AbortController();
    const st = setTimeout(() => ac.abort(), 10000);
    try {
        const res = await fetch(origin + '/generate.php', {
            credentials: 'omit',
            signal: ac.signal,
            headers: { 'User-Agent': UA, 'Referer': NEXUS },
        });
        const tok = res.ok ? pToken(await res.text()) : '';
        if (tok) tCache.set(origin, { token: tok, expires: now + TOKEN_CACHE_MS });
        return tok;
    } finally {
        clearTimeout(st);
    }
}

function wTUrl(url, token) {
    const u = new URL(url);
    u.searchParams.set('token', token);
    return u.toString();
}

// Helper
function hExtract(html, key) {
    const m = html.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'));
    return m ? m[1] : null;
}

// vidsrc.to extraction logic (adapted from foltynsrc)
async function fJson(url, h = {}) {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...h },
        redirect: 'follow',
    });
    return res.json();
}

async function fText(url, h = {}) {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...h },
        redirect: 'follow',
    });
    return res.text();
}

// Server info extraction from vidsrc.to
function eTmdb(html, key) {
    const m = html.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'));
    return m ? m[1] : null;
}

// Named servers configuration
const nServers = [
    // 0: Fireworks (first)
    {
        name: 'Fireworks',
        position: 0,
        gSUrl(tmdb, nMode) {
            return this.eVidsrc(tmdb).then(info => info.vUrl || `https://fW.example.com/hls/movie-${tmdb}/master.m3u8`);
        },
        async eVidsrc(tmdb) {
            try {
                // vidsrc.to gate
                const gJ = await fJson(`${GATE}?type=movie&id=${tmdb}`, {
                    'Accept': 'application/json',
                    'Referer': 'https://vidsrc.to/',
                });
                if (!gJ || !gJ.src) return { vUrl: null, imdb: '' };

                const p1Url = gJ.src;
                const h1 = await fText(p1Url, { 'Referer': 'https://vsembed.ru/' });
                const pU = h1.match(new RegExp('"playerUrl"\\s*:\\s*"([^"]+)"'));
                if (!pU) return { vUrl: null, imdb: '' };

                const p2Url = NEXUS + pU[1];
                const h2 = await fText(p2Url, { 'Referer': NEXUS });
                const a = h2.match(new RegExp('"api"\\s*:\\s*"([^"]+)"'));
                const t = h2.match(new RegExp('"apiToken"\\s*:\\s*"([^"]+)"'));

                if (!a) return { vUrl: null, imdb: '' };

                const sUrl = a[1] + '&api_token=' + (t ? encodeURIComponent(t[1]) : '');
                const j = await fJson(sUrl, {
                    'Accept': 'application/json',
                    'Referer': NEXUS,
                });

                if (j.status_code && String(j.status_code) !== '200') return { vUrl: null, imdb: '' };

                let wU = j.vs && j.vs.wasm_url ? j.vs.wasm_url : null;
                let sUrls = j.data && j.data.stream_urls;

                if (typeof sUrls === 'string') {
                    if (!wU) return { vUrl: null, imdb: '' };
                    sUrls = await dStreamUrls(sUrls, wU);
                }

                if (!Array.isArray(sUrls) || sUrls.length === 0) return { vUrl: null, imdb: '' };

                // Mint token for the origin
                const o = sUrls[0].match(/^https?:\/\/[^/]+/)[0];
                let t2 = '';
                try { t2 = await mToken(o, false); } catch (e) {}

                const s = await aTUrl(sUrls[0], t2);
                const iMdb = j.data && j.data.imdb_id ? j.data.imdb_id : '';

                return { vUrl: s, imdb: iMdb };
            } catch (e) {
                console.error('vidsrc.to extraction error:', e.message);
                return { vUrl: null, imdb: '' };
            }
        },
    },
    // 1: Black Eye (second)
    {
        name: 'Black Eye',
        position: 1,
        gSUrl(tmdb, nMode) {
            return this.eVidsrc(tmdb).then(info => info.vUrl || `https://bE.example.com/hls/movie-${tmdb}/master.m3u8`);
        },
        async eVidsrc(tmdb) {
            return this.servers[0].eVidsrc(tmdb);
        },
    },
    // 2: Whirlpool (third/fallback)
    {
        name: 'Whirlpool',
        position: 2,
        gSUrl(tmdb, nMode) {
            return this.eVidsrc(tmdb).then(info => info.vUrl || `https://wP.example.com/hls/movie-${tmdb}/master.m3u8`);
        },
        async eVidsrc(tmdb) {
            return this.servers[0].eVidsrc(tmdb);
        },
    },
    // 3: Sombrero (beta - unavailable)
    {
        name: 'Sombrero',
        position: 3,
        available: false,
        gSUrl(tmdb, nMode) {
            return Promise.resolve(null);
        },
    },
}

// Apply token to URL
function aTUrl(url, token) {
    if (!token) return url;
    if (url.indexOf('__TOKEN__') > -1) return url.split('__TOKEN__').join(token);
    return url + (url.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

// Async function to decrypt stream URLs (WASM-based)
async function dStreamUrls(encB64, wU) {
    // In production, this would use WebAssembly
    // For now, return mock decrypted URLs
    const decrypted = encB64.split('\\n').filter((s) => s).map((s) => {
        // Mock: prepend a real-like URL
        return 'https://eS.stream/' + btoa(s).substring(0, 20) + '.m3u8';
    });
    return decrypted;
}

// Get server video URL with token minting
async function gSVideoUrl(tmdb, nMode) {
    const s = nServers[0]; // Simplified: use Fireworks
    return s.gSUrl(tmdb, nMode);
}

// Naming mode helper
function nName(index, mode) {
    if (mode === 'universe') {
        const uN = ['Milkyway', 'Andromeda', 'Orion', 'Sombrero', 'Whirlpool', 'Triangulum'];
        return uN[index % uN.length] || `Server ${index + 1}`;
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
    const nMode = req.query.naming === 'universe' ? 'universe' : 'sequential';
    
    if (!tmdb) {
        return res.status(400).json({
            success: false,
            error: 'missing :tmdb_id'
        });
    }

    const servers = await Promise.all(nServers.map((srv, idx) => {
        return gSVideoUrl(tmdb, nMode).then(info => {
            const aV = info.vUrl ? true : false;
            return {
                id: idx + 1,
                name: srv.name,
                available: aV,
                tmdb,
                imdb: info.imdb || '',
                vUrl: info.vUrl || `https://${srv.name.toLowerCase().replace(/\s+/g, '')}.example.com/hls/movie-${tmdb}/master.m3u8`,
                tUrl: `/api/sub/${info.imdb || 'unknown'}`,
                format: 'HLS · master.m3u8',
                sName: srv.name,
                position: srv.position,
                token: info.t2 || '',
                tError: info.t2 ? '' : 'extraction-error'
            };
        }).catch(err => {
            // Fallback on error
            return {
                id: idx + 1,
                name: srv.name,
                available: false,
                tmdb,
                imdb: '',
                vUrl: `https://${srv.name.toLowerCase().replace(/\s+/g, '')}.example.com/hls/movie-${tmdb}/master.m3u8`,
                tUrl: '/api/sub/unknown',
                format: 'HLS · master.m3u8',
                sName: srv.name,
                position: srv.position,
                token: '',
                tError: err.message
            };
        });
    }));

    res.json({
        success: true,
        tmdb,
        naming_mode: nMode,
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
    const iId = req.params.imdb_id;
    
    if (!iId) {
        return res.status(400).json({
            success: false,
            error: 'missing :imdb_id'
        });
    }

    const sData = {
        'tt1234567': {
            success: true,
            tracks: [
                { id: '1962434148', name: 'Obs.2025.720p.WEBRip.srt, language: eng', language: 'eng', format: 'srt' },
                { id: '1962434831', name: 'Obs.2026.1080p.CAM.srt, language: eng', language: 'eng', format: 'srt' }
            ],
            track_count: 2,
            formats: ['srt', 'vtt'],
            wBBase: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/'
        },
        'tt3896011': {
            success: true,
            tracks: [
                { id: '1972345678', name: 'Samp.2024.1080p.WEB-DL.srt, language: eng', language: 'eng', format: 'srt' }
            ],
            track_count: 1,
            formats: ['srt'],
            wBBase: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/'
        },
        'tt1234568': {
            success: true,
            tracks: [],
            track_count: 0,
            formats: [],
            wBBase: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/'
        }
    };

    const d = sData[iId] || {
        success: true,
        tracks: [],
        track_count: 0,
        formats: [],
        wBBase: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/'
    };

    res.json({
        success: d.success,
        iId: iId,
        tCount: d.track_count,
        tFormats: d.formats,
        tracks: d.tracks,
        wBBase: d.wBBase
    });
});

/**
 * GET /api/sub/:imdb_id/:subtitle_id
 * Returns WebVTT subtitle URL
 */
app.get('/api/sub/:imdb_id/:sId', (req, res) => {
    const iId = req.params.imdb_id;
    const sId = req.params.sId;

    if (!sId) {
        return res.status(400).json({
            success: false,
            error: 'missing :subtitle_id'
        });
    }

    const n = 'https://stellarconductornexus.com';
    const wVttUrl = `${n}/embed/iframe_player/cache/subs/19/${sId}.vtt`;

    res.json({
        success: true,
        iId: iId,
        sId: sId,
        wVttUrl: wVttUrl,
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
        console.log('  GET /api/sub/:imdb_id/:sId    -> WebVTT subtitle URL');
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