// Render Web Service — serves the website AND the API from one Node process
const http = require('http');
const fs = require('fs');
const path = require('path');

// In-memory state (resets when the free service sleeps)
let relayState = {
    relay: false,
    tds: 0,
    timestamp: 0
};

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.writeHead(200).end();
    }

    // ---- API: /api/status ----
    if (pathname === '/api/status') {
        if (req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            return res.writeHead(200).end(JSON.stringify(relayState));
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk;
                if (body.length > 100000) req.destroy();
            });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body || '{}');

                    if (data.relay !== undefined) {
                        relayState = {
                            relay: !!data.relay,
                            tds: data.tds || 0,
                            timestamp: data.timestamp || Math.floor(Date.now() / 1000)
                        };
                    } else if (data.action === 'toggle') {
                        relayState.relay = !relayState.relay;
                        relayState.timestamp = Math.floor(Date.now() / 1000);
                    }
                } catch (e) {
                    res.setHeader('Content-Type', 'application/json');
                    return res.writeHead(400).end(JSON.stringify({ error: 'Invalid JSON' }));
                }

                res.setHeader('Content-Type', 'application/json');
                res.writeHead(200).end(JSON.stringify(relayState));
            });
            return;
        }

        res.setHeader('Content-Type', 'application/json');
        return res.writeHead(405).end(JSON.stringify({ error: 'Method not allowed' }));
    }

    // ---- Static files ----
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const fullPath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^(\.\.[/\\])+/, ''));

    // Prevent directory traversal
    if (!fullPath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404).end('Not Found');
            return;
        }
        const ext = path.extname(fullPath);
        const types = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.svg': 'image/svg+xml'
        };
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        res.writeHead(200).end(data);
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
