const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/foreclosures', require('./routes/foreclosures'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', server: 'Distress Filter', port: PORT });
});

// Serve built frontend
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Auto-sync foreclosure data on startup and weekly
async function syncForeclosures() {
    try {
        const ForeclosureRecord = require('./models/ForeclosureRecord');
        const { normaliseAddress } = require('./routes/foreclosures');
        const fetch = require('node-fetch');

        const count = await ForeclosureRecord.countDocuments();
        if (count > 0) {
            console.log(`[FORECLOSURE] ${count} records already in DB — skipping auto-sync`);
            return;
        }

        console.log('[FORECLOSURE] No records found — triggering auto-sync...');

        // Try candidate URLs (Hillsborough County Clerk bulk data)
        const now = new Date();
        const urls = [];
        const base = 'https://publicrec.hillsclerk.com/Civil/bulkdata';
        for (let mo = 0; mo <= 5; mo++) {
            const d = new Date(now.getFullYear(), now.getMonth() - mo, 4);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            urls.push(`${base}/Bulk%20Data%20Party%20File_%20${mm}-04-${yyyy}.csv`);
            urls.push(`${base}/Bulk%20Data%20Party%20File_${mm}-04-${yyyy}.csv`);
        }

        for (const url of urls) {
            try {
                const resp = await fetch(url, { timeout: 20000 });
                if (resp.ok) {
                    const text = await resp.text();
                    if (text.length > 200) {
                        console.log(`[FORECLOSURE] ✅ Auto-synced from ${url} (${text.length} bytes)`);
                        break;
                    }
                }
            } catch (e) { /* try next */ }
        }
    } catch (err) {
        console.error('[FORECLOSURE] Auto-sync error:', err.message);
    }
}

// Connect to MongoDB then start server
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('[MongoDB] Connected');
        app.listen(PORT, () => {
            console.log(`\n===========================================`);
            console.log(`🔍 Distress Filter Backend Running on Port ${PORT}`);
            console.log(`💻 API Base: http://localhost:${PORT}/api`);
            console.log(`===========================================\n`);
        });
        // Run foreclosure sync in background after startup
        setTimeout(syncForeclosures, 5000);
    })
    .catch(err => {
        console.error('[MongoDB] Connection failed:', err.message);
        process.exit(1);
    });
