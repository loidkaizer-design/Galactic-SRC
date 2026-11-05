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

// Token minting
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const TOKEN_CACHE_MS = 4 * 60 * 1000;
const tCache = new Map();

function pToken(text) {
    if (text == null) return '';
    const t = String(text).trim();
    if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
        try { const j = JSON.parse(t); if (typeof j === 'string') return j; if (j && typeof j === 'object') return j.token || j.data || j.string || j.result || ''; } catch (e) {}
    }
    return t;
}

async function mToken(origin, force) {
    const now = Date.now();
    const hit = tCache.get(origin);
    if (!force && hit && hit.expires > now) return hit.token;
    const ac = new AbortController(); const st = setTimeout(() => ac.abort(), 10000);
    try { const res = await fetch(origin + '/generate.php', { credentials: 'omit', signal: ac.signal, headers: { 'User-Agent': UA } }); const tok = res.ok ? pToken(await res.text()) : ''; if (tok) tCache.set(origin, { token: tok, expires: now + TOKEN_CACHE_MS }); return tok; } finally { clearTimeout(st); }
}

// Server definitions (ordered: Fireworks, Black Eye, Whirlpool, Sombrero)
const SERVERS = [
    { name: 'Fireworks', position: 0, available: true, getVideoUrl(tmdb) { return { vUrl: 'https://fireworks.example.com/hls/movie-' + tmdb + '/master.m3u8', tUrl: '/api/sub/tt1234567', minted: false, tToken: '' }; }, async mint(tmdb) { const origin = '127.0.0.1'; const token = await mToken(origin, false); return { ...this.getVideoUrl(tmdb), tToken: token, minted: true }; } },
    { name: 'Black Eye', position: 1, available: true, getVideoUrl(tmdb) { return { vUrl: 'https://blckeye.example.com/hls/movie-' + tmdb + '/master.m3u8', tUrl: '/api/sub/tt1234567', minted: false, tToken: '' }; }, async mint(tmdb) { const origin = '127.0.0.1'; const token = await mToken(origin, false); return { ...this.getVideoUrl(tmdb), tToken: token, minted: true }; } },
    { name: 'Whirlpool', position: 2, available: true, getVideoUrl(tmdb) { return { vUrl: 'https://whirlpool.example.com/hls/movie-' + tmdb + '/master.m3u8', tUrl: '/api/sub/tt1234567', minted: false, tToken: '' }; }, async mint(tmdb) { const origin = '127.0.0.1'; const token = await mToken(origin, false); return { ...this.getVideoUrl(tmdb), tToken: token, minted: true }; } },
    { name: 'Sombrero', position: 3, available: false, getVideoUrl(tmdb) { return { vUrl: null, tUrl: null, minted: false, tToken: '' }; }, async mint(tmdb) { return { ...this.getVideoUrl(tmdb), tToken: '', minted: false }; } }
];

// Endpoints
app.get('/health', (req, res) => { res.json({ ok: true, project: 'galactic' }); });
app.get('/api/movie/:tmdb_id', async (req, res) => {
    const tmdb = req.params.tmdb_id;
    const nMode = req.query.naming === 'universe' ? 'universe' : 'sequential';
    if (!tmdb) return res.status(400).json({ success: false, error: 'missing :tmdb_id' });
    const servers = SERVERS.map((s, idx) => {
        const info = s.getVideoUrl(tmdb);
        return { id: idx + 1, name: s.name, available: s.available, tmdb, imdb: 'tt1234567', video_url: info.vUrl, thumbnail_url: 'https://' + s.name.toLowerCase().replace(/\s+/g, '') + '.example.com/thumbs/movie-' + tmdb + '.jpg', subtitle_url: info.tUrl, format: 'HLS · master.m3u8', server_name: s.name, position: s.position, token: info.tToken || '', tokenError: info.tToken ? null : 'token-unavailable' };
    });
    res.json({ success: true, tmdb, naming_mode: nMode, title: 'Movie ' + tmdb, servers: servers, server_count: servers.length });
});
app.get('/api/sub/:imdb_id', (req, res) => {
    const iId = req.params.imdb_id; if (!iId) return res.status(400).json({ success: false, error: 'missing :imdb_id' });
    const sData = { 'tt1234567': { success: true, tracks: [{ id: '1962434148', name: 'Obs.2025.720p.WEBRip.srt, language: eng', language: 'eng', format: 'srt' }, { id: '1962434831', name: 'Obs.2026.1080p.CAM.srt, language: eng', language: 'eng', format: 'srt' }], track_count: 2, formats: ['srt', 'vtt'], wBBase: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' }, 'tt3896011': { success: true, tracks: [{ id: '1972345678', name: 'Samp.2024.1080p.WEB-DL.srt, language: eng', language: 'eng', format: 'srt' }], track_count: 1, formats: ['srt'], wBBase: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' }, 'tt1234568': { success: true, tracks: [], track_count: 0, formats: [], wBBase: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' } };
    const d = sData[iId] || { success: true, tracks: [], track_count: 0, formats: [], wBBase: 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' };
    res.json({ success: d.success, iId: iId, tCount: d.track_count, tFormats: d.formats, tracks: d.tracks, wBBase: d.wBBase });
});
app.get('/api/sub/:imdb_id/:sId', (req, res) => { const iId = req.params.imdb_id; const sId = req.params.sId; if (!sId) return res.status(400).json({ success: false, error: 'missing :subtitle_id' }); const wVttUrl = 'https://stellarconductornexus.com/embed/iframe_player/cache/subs/19/' + sId + '.vtt'; res.json({ success: true, iId: iId, sId: sId, wVttUrl: wVttUrl, format: 'webvtt' }); });
app.get('/api/player', (req, res) => { res.json({ success: true, message: 'Player endpoint - video player will be uploaded and connected later', endpoint: '/api/player', status: 'placeholder' }); });
app.get('/api/movie/:tmdb_id/:subtitle_id', (req, res) => { /* not used */ });
app.get('/health', (req, res) => { res.json({ ok: true, project: 'galactic' }); });

// Start server
if (require.main === module) { app.listen(PORT, () => { console.log('galactic API listening on http://localhost:' + PORT); console.log('Endpoints:'); console.log('  GET /health -> health check'); console.log('  GET /api/movie/:tmdb_id -> movie info with servers'); console.log('  GET /api/sub/:imdb_id -> subtitle tracks'); console.log('  GET /api/sub/:imdb_id/:sId -> WebVTT subtitle URL'); console.log('  GET /api/player -> player placeholder'); console.log(''); console.log('Server ordering:'); console.log('  0: Fireworks (first)'); console.log('  1: Black Eye (second)'); console.log('  2: Whirlpool (third/fallback)'); console.log('  3: Sombrero (beta - unavailable)'); }); }
module.exports = app;