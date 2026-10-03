// Vercel Serverless Function — Water Salinity Status API
// ESP32 POSTs sensor data here, website GETs data from here

let relayState = {
    relay: false,
    tds: 0,
    timestamp: 0
};

export default function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // GET: Return current status
    if (req.method === 'GET') {
        return res.status(200).json(relayState);
    }

    // POST: Update status from ESP32
    if (req.method === 'POST') {
        const body = req.body || {};

        if (body.relay !== undefined) {
            relayState = {
                relay: body.relay,
                tds: body.tds || 0,
                timestamp: body.timestamp || Math.floor(Date.now() / 1000)
            };
        } else if (body.action === 'toggle') {
            relayState.relay = !relayState.relay;
            relayState.timestamp = Math.floor(Date.now() / 1000);
        }

        return res.status(200).json(relayState);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
