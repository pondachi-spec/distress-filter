const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const ForeclosureRecord = require('../models/ForeclosureRecord');
const auth = require('../middleware/auth');

// ============================================================
// Hillsborough County Clerk — Civil Bulk Data CSV URLs
// These are public files published monthly at publicrec.hillsclerk.com
// ============================================================

// Build candidate URLs based on current + previous months
function buildCandidateUrls() {
    const urls = [];
    const now = new Date();

    for (let monthOffset = 0; monthOffset <= 3; monthOffset++) {
        const d = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
        const yyyy = d.getFullYear();
        const mm   = String(d.getMonth() + 1).padStart(2, '0');

        // Known Hillsborough County Clerk bulk data URL patterns
        const base = 'https://publicrec.hillsclerk.com/Civil';

        urls.push(
            `${base}/Circuit%20Civil/MortgageForeclosure_${yyyy}-${mm}.csv`,
            `${base}/Foreclosure/MortgageForeclosure_${yyyy}-${mm}.csv`,
            `${base}/Circuit%20and%20County%20Civil/CircuitCivilData_${yyyy}-${mm}.csv`,
            `${base}/CircuitCivil_${yyyy}-${mm}.csv`,
        );
    }

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
    const urls = buildCandidateUrls();
    let fetchedUrl = null;
    let rawCSV = null;

    console.log('[FORECLOSURE] Trying', urls.length, 'candidate URLs...');

    for (const url of urls) {
        try {
            const resp = await fetch(url, {
                headers: { 'Accept': 'text/csv,text/plain,*/*' },
                timeout: 15000
            });
            if (resp.ok) {
                rawCSV = await resp.text();
                if (rawCSV.length > 100) { // sanity check — not empty
                    fetchedUrl = url;
                    console.log('[FORECLOSURE] ✅ Fetched from', url, '— bytes:', rawCSV.length);
                    break;
                }
            }
        } catch (e) {
            // Try next URL
        }
    }

    if (!rawCSV) {
        console.warn('[FORECLOSURE] ❌ No CSV found at any candidate URL');
        return res.status(502).json({
            error: 'Could not fetch foreclosure CSV from Hillsborough County Clerk.',
            tried: urls,
            hint: 'Visit https://publicrec.hillsclerk.com/Civil/ to find the correct URL and update buildCandidateUrls().'
        });
    }

    const rows = parseCSV(rawCSV);
    if (rows.length === 0) {
        return res.status(500).json({ error: 'CSV parsed but contained no rows.' });
    }

    const headers = Object.keys(rows[0]);
    console.log('[FORECLOSURE] CSV headers:', headers.join(', '));

    const addrCol   = detectAddressColumn(headers);
    const caseCol   = headers.find(h => h.includes('CASE') && h.includes('NUM'));
    const typeCol   = headers.find(h => h.includes('TYPE'));
    const dateCol   = headers.find(h => h.includes('DATE') || h.includes('FILED'));
    const defCol    = headers.find(h => h.includes('DEFENDANT') || h.includes('DEF'));
    const plnCol    = headers.find(h => h.includes('PLAINTIFF') || h.includes('PLN'));
    const zipCol    = headers.find(h => h.includes('ZIP'));
    const cityCol   = headers.find(h => h.includes('CITY'));

    console.log('[FORECLOSURE] Detected columns — addr:', addrCol, 'case:', caseCol, 'type:', typeCol);

    // Mortgage foreclosure case types in Florida: MF, MFC, MORT, FORE
    const MF_TYPES = ['MF', 'MFC', 'MORT', 'FORE', 'MORTGAGE', 'FORECLOSURE'];

    let imported = 0;
    let skipped  = 0;
    const ops    = [];

    for (const row of rows) {
        const caseType = typeCol ? (row[typeCol] || '').toUpperCase() : '';
        const isMortgageFore = MF_TYPES.some(t => caseType.includes(t));

        // If we can detect case type and it's not foreclosure, skip
        if (typeCol && !isMortgageFore) { skipped++; continue; }

        const rawAddr = addrCol ? row[addrCol] : '';
        const normAddr = normaliseAddress(rawAddr);
        if (!normAddr) { skipped++; continue; }

        const caseNumber = caseCol ? row[caseCol] : `UNKNOWN-${imported}`;

        ops.push({
            updateOne: {
                filter: { caseNumber },
                update: {
                    $set: {
                        caseNumber,
                        caseType: typeCol ? row[typeCol] : 'UNKNOWN',
                        fileDate: dateCol ? new Date(row[dateCol]) : null,
                        plaintiff: plnCol ? row[plnCol] : '',
                        defendant: defCol ? row[defCol] : '',
                        propertyAddress: normAddr,
                        city: cityCol ? (row[cityCol] || '').toUpperCase() : '',
                        zip: zipCol ? (row[zipCol] || '').substring(0, 5) : '',
                        source: 'HC-CLERK'
                    }
                },
                upsert: true
            }
        });
        imported++;
    }

    if (ops.length > 0) {
        await ForeclosureRecord.bulkWrite(ops, { ordered: false });
    }

    const total = await ForeclosureRecord.countDocuments();
    console.log(`[FORECLOSURE] Imported ${imported} records, skipped ${skipped}. Total in DB: ${total}`);

    res.json({
        success: true,
        fetchedUrl,
        rowsInCSV: rows.length,
        imported,
        skipped,
        totalInDB: total,
        detectedColumns: { addrCol, caseCol, typeCol, dateCol, defCol }
    });
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
