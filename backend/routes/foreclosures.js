const express = require('express');
const router = express.Router();
const ForeclosureRecord = require('../models/ForeclosureRecord');
const auth = require('../middleware/auth');
const { runSync, normaliseAddress } = require('../lib/syncForeclosures');

// ============================================================
// POST /api/foreclosures/sync  — fetch & index Clerk CSV
// ============================================================
router.post('/sync', auth, async (req, res) => {
    const result = await runSync();
    if (!result.success) return res.status(502).json(result);
    res.json(result);
});

// ============================================================
// GET /api/foreclosures/status
// ============================================================
router.get('/status', auth, async (req, res) => {
    const total = await ForeclosureRecord.countDocuments();
    const newest = await ForeclosureRecord.findOne().sort({ createdAt: -1 });
    res.json({ totalRecords: total, lastSync: newest ? newest.createdAt : null, hasData: total > 0 });
});

// ============================================================
// GET /api/foreclosures/check?address=123+MAIN+ST&zip=33610
// ============================================================
router.get('/check', auth, async (req, res) => {
    const { address, zip } = req.query;
    if (!address) return res.status(400).json({ error: 'address required' });
    const norm = normaliseAddress(address);
    const query = { propertyAddress: { $regex: norm.split(' ').slice(0, 3).join(' '), $options: 'i' } };
    if (zip) query.zip = zip.substring(0, 5);
    const match = await ForeclosureRecord.findOne(query);
    res.json({ isPreForeclosure: !!match, match });
});

module.exports = router;
