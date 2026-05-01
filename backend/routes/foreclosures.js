const express = require('express');
const router = express.Router();
const ForeclosureRecord = require('../models/ForeclosureRecord');
const auth = require('../middleware/auth');
const { runSync, normaliseAddress, buildCandidateUrls } = require('../lib/syncForeclosures');

// ============================================================
// Hillsborough County Clerk — Civil Bulk Data CSV URLs
// These are public files published monthly at publicrec.hillsclerk.com
// ============================================================

// Build candidate URLs based on current + previous months
// Hillsborough County Clerk publishes monthly bulk data files on the 4th of each month
// Format: https://publicrec.hillsclerk.com/Civil/bulkdata/Bulk%20Data%20Party%20File_%20MM-DD-YYYY.csv
function buildCandidateUrls() {
    const urls = [];
    const now = new Date();
    const base = 'https://publicrec.hillsclerk.com/Civil/bulkdata';

    for (let monthOffset = 0; monthOffset <= 5; monthOffset++) {
        const d = new Date(now.getFullYear(), now.getMonth() - monthOffset, 4);
        const yyyy = d.getFullYear();
        const mm   = String(d.getMonth() + 1).padStart(2, '0');
        const dd   = '04';

        // Primary format (space-encoded): "Bulk Data Party File_ MM-DD-YYYY.csv"
        urls.push(`${base}/Bulk%20Data%20Party%20File_%20${mm}-${dd}-${yyyy}.csv`);
        // Alternate without leading space after underscore
        urls.push(`${base}/Bulk%20Data%20Party%20File_${mm}-${dd}-${yyyy}.csv`);
    }

    // Also try daily filings directory for most recent data
    const today = now;
    const yy = today.getFullYear();
    const mo = String(today.getMonth() + 1).padStart(2, '0');
    const da = String(today.getDate()).padStart(2, '0');
    urls.push(`https://publicrec.hillsclerk.com/Civil/dailyfilings/CivilFiling_${yy}${mo}${da}.csv`);

    return urls;
}

// Normalise an address string for consistent matching
function normaliseAddress(raw) {
    if (!raw) return '';
    return raw
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .replace(/\bST\b/g, 'ST')
        .replace(/\bAVE\b/g, 'AVE')
        .replace(/\bBLVD\b/g, 'BLVD')
        .replace(/\bDR\b/g, 'DR')
        .replace(/\bRD\b/g, 'RD')
        .replace(/[^A-Z0-9 ]/g, '')
        .trim();
}

// Parse raw CSV text into array of objects using first-row headers
function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toUpperCase());
    const records = [];

    for (let i = 1; i < lines.length; i++) {
        // Handle quoted fields with commas inside
        const cols = [];
        let current = '';
        let inQuote = false;
        for (const ch of lines[i]) {
            if (ch === '"') { inQuote = !inQuote; continue; }
            if (ch === ',' && !inQuote) { cols.push(current.trim()); current = ''; continue; }
            current += ch;
        }
        cols.push(current.trim());

        const row = {};
        headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });
        records.push(row);
    }

    return records;
}

// Detect which column contains the property address in the CSV
function detectAddressColumn(headers) {
    const candidates = ['PROPERTY ADDRESS', 'PROP_ADDR', 'ADDRESS', 'SITUS', 'STREET ADDRESS',
                        'DEFENDANT ADDRESS', 'DEF_ADDR', 'ADDR1'];
    return candidates.find(c => headers.includes(c));
}

// ============================================================
// POST /api/foreclosures/sync  — fetch & index Clerk CSV
// ============================================================
router.post('/sync', auth, async (req, res) => {
    const result = await runSync();
    if (!result.success) {
        return res.status(502).json(result);
    }
    res.json(result);
});

// ============================================================
// GET /api/foreclosures/status
// ============================================================
router.get('/status', auth, async (req, res) => {
    const total = await ForeclosureRecord.countDocuments();
    const newest = await ForeclosureRecord.findOne().sort({ createdAt: -1 });
    res.json({
        totalRecords: total,
        lastSync: newest ? newest.createdAt : null,
        hasData: total > 0
    });
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
module.exports.normaliseAddress = normaliseAddress;
