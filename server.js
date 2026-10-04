// Render Web Service — dashboard + admin panel + ESP32 API
// No external dependencies.
//
//   GET  /                 public dashboard
//   GET  /admin            control panel (threshold, manual pump override)
//   GET  /api/status       current state + config
//   POST /api/status       ESP32 pushes a reading
//   GET  /api/cmd          ESP32 polls for a pending admin command
//   POST /api/control      admin sets mode / threshold / pump
//
// State is in memory and resets when the free service sleeps.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const HISTORY_MAX = 120;

let state = {
    relay: false,        // last reported pump state
    tds: 0,              // last reported TDS
    demo: false,         // ESP32 is simulating
    online: false,       // seen an update recently
    lastSeen: 0,         // epoch seconds of last ESP32 update

    threshold: 500,      // ppm above this = salty
    mode: 'auto',        // 'auto' | 'on' | 'off'

    pending: null,       // { action, ts } - consumed by the ESP32
    history: []          // recent readings for the chart
};

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

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.writeHead(200).end();

    // ---------- ESP32 pushes a reading ----------
    if (p === '/api/status' && req.method === 'POST') {
        readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                if (d.relay !== undefined) state.relay = !!d.relay;
                if (d.tds !== undefined)    state.tds = Number(d.tds) || 0;
                if (d.demo !== undefined)   state.demo = !!d.demo;

                state.lastSeen = Math.floor(Date.now() / 1000);

                state.history.push({
                    t: state.lastSeen,
                    tds: state.tds,
                    relay: state.relay
                });
                if (state.history.length > HISTORY_MAX) state.history.shift();

                json(res, 200, snapshot());
            } catch (e) {
                json(res, 400, { error: 'Invalid JSON' });
            }
        });
        return;
    }

    // ---------- read current state ----------
    if (p === '/api/status' && req.method === 'GET') {
        return json(res, 200, snapshot());
    }

    // ---------- ESP32 polls for an admin command ----------
    if (p === '/api/cmd' && req.method === 'GET') {
        const cmd = state.pending;
        state.pending = null;                 // consume it
        return json(res, 200, {
            mode: state.mode,
            threshold: state.threshold,
            pending: cmd
        });
    }

    // ---------- admin sends a command ----------
    if (p === '/api/control' && req.method === 'POST') {
        readBody(req, body => {
            try {
                const d = JSON.parse(body || '{}');
                const now = Math.floor(Date.now() / 1000);

                if (d.mode && ['auto', 'on', 'off'].includes(d.mode)) {
                    state.mode = d.mode;
                    state.pending = { action: 'mode', value: d.mode, ts: now };
                }
                if (d.threshold !== undefined) {
                    const t = Math.max(0, Math.min(20000, Number(d.threshold) || 0));
                    state.threshold = t;
                    state.pending = { action: 'threshold', value: t, ts: now };
                }
                if (d.pump) {                    // 'on' | 'off'
                    state.pending = { action: 'pump', value: d.pump, ts: now };
                    state.mode = 'manual';
                }
                if (d.clearHistory) state.history = [];

                json(res, 200, snapshot());
            } catch (e) {
                json(res, 400, { error: 'Invalid JSON' });
            }
        });
        return;
    }

    // ---------- static ----------
    let rel = p === '/' ? '/index.html' : (p === '/admin' ? '/admin.html' : p);
    const full = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

    if (!full.startsWith(PUBLIC_DIR)) {
        return res.writeHead(403).end('Forbidden');
    }

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
    state.online = now - state.lastSeen < 30;
    return {
        relay: state.relay,
        tds: state.tds,
        demo: state.demo,
        online: state.online,
        threshold: state.threshold,
        mode: state.mode,
        salty: state.tds > state.threshold,
        uptime: now - state.lastSeen,
        history: state.history
    };
}

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
