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

// ── Browser-friendly cache clear (before static files so it's never intercepted) ──
app.get('/clear-cache', async (req, res) => {
    if (req.query.key !== 'distress2024') {
        return res.status(403).send('Invalid key');
    }
    try {
        const Lead = require('./models/Lead');
        const result = await Lead.deleteMany({ source: 'FL-PUBLIC' });
        res.send(`<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;background:#0f0f1a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px">
            <div style="font-size:56px">✅</div>
            <h2 style="color:#a78bfa;margin:0">Cache Cleared!</h2>
            <p style="color:#94a3b8;margin:0">Deleted <strong style="color:#fff">${result.deletedCount}</strong> cached leads.</p>
            <p style="color:#64748b;font-size:14px">Go back and run a fresh search.</p>
            <a href="/" style="margin-top:8px;padding:10px 28px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">← Back to App</a>
        </body></html>`);
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

// Serve built frontend
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Auto-sync foreclosure data on startup
async function syncForeclosures() {
    try {
        const ForeclosureRecord = require('./models/ForeclosureRecord');
        const count = await ForeclosureRecord.countDocuments();
        if (count > 0) {
            console.log(`[FORECLOSURE] ${count} records already in DB — skipping auto-sync`);
            return;
        }
        console.log('[FORECLOSURE] No records found — triggering auto-sync...');
        const { runSync } = require('./lib/syncForeclosures');
        const result = await runSync();
        console.log('[FORECLOSURE] Auto-sync result:', JSON.stringify(result));
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
