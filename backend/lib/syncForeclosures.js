/**
 * Shared foreclosure sync logic
 * Used by both server.js (auto-sync on startup) and the /api/foreclosures/sync route
 */
const fetch = require('node-fetch');
const ForeclosureRecord = require('../models/ForeclosureRecord');

const BASE = 'https://publicrec.hillsclerk.com/Civil/bulkdata';

function buildCandidateUrls() {
    const urls = [];
    const now = new Date();
    for (let mo = 0; mo <= 5; mo++) {
        const d = new Date(now.getFullYear(), now.getMonth() - mo, 4);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        urls.push(`${BASE}/Bulk%20Data%20Party%20File_%20${mm}-04-${yyyy}.csv`);
        urls.push(`${BASE}/Bulk%20Data%20Party%20File_${mm}-04-${yyyy}.csv`);
    }
    return urls;
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toUpperCase());
    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = [];
        let cur = '', inQ = false;
        for (const ch of lines[i]) {
            if (ch === '"') { inQ = !inQ; continue; }
            if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
            cur += ch;
        }
        cols.push(cur.trim());
        const row = {};
        headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });
        records.push(row);
    }
    return records;
}

function normaliseAddress(raw) {
    if (!raw) return '';
    return raw.toUpperCase().replace(/\s+/g, ' ').replace(/[^A-Z0-9 ]/g, '').trim();
}

// Mortgage foreclosure case type codes used in FL clerk data
const MF_TYPES = ['MF', 'MFC', 'MORT', 'FORE', 'MORTGAGE', 'FORECLOSURE'];

async function runSync() {
    const urls = buildCandidateUrls();
    let rawCSV = null, fetchedUrl = null;

    for (const url of urls) {
        try {
            const resp = await fetch(url, { headers: { Accept: 'text/csv,*/*' }, timeout: 25000 });
            if (resp.ok) {
                const text = await resp.text();
                if (text.length > 500) { rawCSV = text; fetchedUrl = url; break; }
            }
        } catch (_) {}
    }

    if (!rawCSV) {
        console.warn('[FORECLOSURE] ❌ No CSV accessible at any candidate URL');
        return { success: false, error: 'No CSV found', tried: urls };
    }

    console.log(`[FORECLOSURE] ✅ Fetched ${rawCSV.length} bytes from ${fetchedUrl}`);

    const rows = parseCSV(rawCSV);
    if (rows.length === 0) return { success: false, error: 'CSV empty after parse' };

    const headers = Object.keys(rows[0]);
    console.log('[FORECLOSURE] Columns:', headers.join(', '));

    // Try to auto-detect columns
    const find = (...terms) => headers.find(h => terms.some(t => h.includes(t)));
    const caseCol  = find('CASE NUM', 'CASE_NUM', 'CASENUMBER', 'CASE NUMBER');
    const typeCol  = find('CASE TYPE', 'TYPE', 'CASETYPE');
    const addrCol  = find('ADDRESS', 'ADDR', 'SITUS', 'STREET');
    const defCol   = find('DEFENDANT', 'DEF NAME', 'PARTY NAME');
    const plnCol   = find('PLAINTIFF', 'PLN');
    const zipCol   = find('ZIP');
    const cityCol  = find('CITY');
    const dateCol  = find('FILE DATE', 'FILED', 'DATE');

    console.log('[FORECLOSURE] Detected → case:', caseCol, 'type:', typeCol, 'addr:', addrCol, 'def:', defCol);

    const ops = [];
    let imported = 0, skipped = 0;

    for (const row of rows) {
        const caseType = typeCol ? (row[typeCol] || '').toUpperCase() : '';
        const isMF = !typeCol || MF_TYPES.some(t => caseType.includes(t));
        if (!isMF) { skipped++; continue; }

        const rawAddr = addrCol ? row[addrCol] : '';
        const normAddr = normaliseAddress(rawAddr);
        if (!normAddr) { skipped++; continue; }

        const caseNumber = caseCol ? row[caseCol] : `NOID-${imported}`;

        ops.push({
            updateOne: {
                filter: { caseNumber },
                update: {
                    $set: {
                        caseNumber,
                        caseType: typeCol ? row[typeCol] : '',
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
        await ForeclosureRecord.bulkWrite(ops, { ordered: false }).catch(e => {
            console.warn('[FORECLOSURE] bulkWrite partial error:', e.message);
        });
    }

    const total = await ForeclosureRecord.countDocuments();
    console.log(`[FORECLOSURE] Stored ${imported} records (${skipped} skipped). Total in DB: ${total}`);
    return { success: true, fetchedUrl, rowsInCSV: rows.length, imported, skipped, totalInDB: total };
}

module.exports = { runSync, normaliseAddress, buildCandidateUrls };
