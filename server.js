// Render Web Service — dashboard + simple admin
//
//   GET  /            public dashboard (read only)
//   GET  /admin       two buttons: Salt / Fresh
//   GET  /api/status  current displayed reading
//   POST /api/status  ESP32 pushes its live sensor reading
//   POST /api/control admin sets what the dashboard displays
//
// State is in memory and resets when the free service sleeps.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '6767';

const HISTORY_MAX = 120;
const SALT_PPM = 1800;
const FRESH_PPM = 120;

let state = {
    liveTds: 0,          // real reading from the ESP32
    liveRelay: false,
    demo: false,
    lastSeen: 0,         // epoch seconds, 0 = never
    override: 'live',     // 'live' | 'salt' | 'fresh'
    manual: 'auto',       // motor: 'auto' | 'on' | 'off'
    pending: null,        // command queued for the ESP32
    history: []
};

function authorized(req) {
    const h = req.headers['x-admin-pass'];
    return typeof h === 'string' && h.length > 0 && h === ADMIN_PASSWORD;
}

function json(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function readBody(req, cb) {
    let body = '';
    req.on('data', c => {
        body += c;
        if (body.length > 100000) req.destroy();
    });
    req.on('end', () => cb(body));
}

// What the dashboard shows. Manual motor setting wins; otherwise the
// water-type override, otherwise the real sensor.
function effective() {
    const base = state.override === 'salt'  ? { tds: SALT_PPM,  salty: true }
               : state.override === 'fresh' ? { tds: FRESH_PPM, salty: false }
               : { tds: state.liveTds, salty: state.liveTds > 500 };

    if (state.manual === 'on')  return { tds: base.tds, relay: true,  salty: base.salty };
    if (state.manual === 'off') return { tds: base.tds, relay: false, salty: base.salty };

    return { tds: base.tds, relay: base.salty, salty: base.salty };
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Pass');
    if (req.method === 'OPTIONS') return res.writeHead(200).end();

    // ---------- ESP32 pushes its live reading ----------
    if (p === '/api/status' && req.method === 'POST') {
        readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                if (d.tds !== undefined)    state.liveTds = Number(d.tds) || 0;
                if (d.relay !== undefined) state.liveRelay = !!d.relay;
                if (d.demo !== undefined)  state.demo = !!d.demo;
                state.lastSeen = Math.floor(Date.now() / 1000);

                const e = effective();
                state.history.push({ t: state.lastSeen, tds: e.tds, relay: e.relay });
                if (state.history.length > HISTORY_MAX) state.history.shift();

                json(res, 200, snapshot());
            } catch (err) {
                json(res, 400, { error: 'Invalid JSON' });
            }
        });
        return;
    }

    if (p === '/api/status' && req.method === 'GET') {
        return json(res, 200, snapshot());
    }

    // ---------- admin picks the displayed water type + motor ----------
    if (p === '/api/control' && req.method === 'POST') {
        if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });

        readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');

                if (d.water && ['live', 'salt', 'fresh'].includes(d.water)) {
                    state.override = d.water;
                    console.log('Water override:', d.water);
                }

                // Manual pump control -> queued for the ESP32 to pick up
                if (d.pump === 'on' || d.pump === 'off') {
                    state.manual = d.pump;
                    state.pending = { action: 'pump', value: d.pump, ts: Date.now() };
                    console.log('Motor command queued:', d.pump);
                }
                if (d.pump === 'auto') {
                    state.manual = 'auto';
                    console.log('Motor returned to auto');
                }

                json(res, 200, snapshot());
            } catch (err) {
                json(res, 400, { error: 'Invalid JSON' });
            }
        });
        return;
    }

    // ---------- ESP32 polls for a motor command ----------
    if (p === '/api/cmd' && req.method === 'GET') {
        if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });
        const cmd = state.pending;
        state.pending = null;                    // consume
        return json(res, 200, { manual: state.manual, pending: cmd });
    }

    // ---------- static ----------
    const rel = p === '/' ? '/index.html' : (p === '/admin' ? '/admin.html' : p);
    const full = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

    if (!full.startsWith(PUBLIC_DIR)) return res.writeHead(403).end('Forbidden');

    fs.readFile(full, (err, data) => {
        if (err) return res.writeHead(404).end('Not Found');
        const types = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };
        res.writeHead(200, {
            'Content-Type': types[path.extname(full)] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        });
        res.end(data);
    });
});

function snapshot() {
    const now = Math.floor(Date.now() / 1000);
    const seen = state.lastSeen > 0 ? now - state.lastSeen : -1;
    const e = effective();

    return {
        tds: e.tds,
        relay: e.relay,
        salty: e.salty,
        override: state.override,
        manual: state.manual,
        liveTds: state.liveTds,
        online: seen >= 0 && seen < 60,
        demo: state.demo,
        uptime: seen,
        history: state.history
    };
}

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
