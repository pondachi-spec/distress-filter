const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const Lead = require('../models/Lead');
const ForeclosureRecord = require('../models/ForeclosureRecord');
const auth = require('../middleware/auth');
const { Parser } = require('json2csv');
const { normaliseAddress } = require('../lib/syncForeclosures');
const { skipTraceLead } = require('../lib/skipTrace');

// ==========================================
// Motivation Score Engine
// ==========================================
function calcMotivationScore(props) {
    let score = 0;
    if (props.equityPercent > 40) score += 30;
    if (props.isAbsenteeOwner) score += 25;
    if (props.yearsOwned >= 10) score += 20;
    if (props.isPreForeclosure) score += 30;
    if (props.isTaxDelinquent) score += 25;
    if (props.isSeniorOwner && props.equityPercent >= 50) score += 20;  // senior + high equity = downsizing
    if (props.isVacant) score += 15;                                     // vacant = flexible / distressed
    if (props.hasCodeViolation) score += 20;                             // regulatory pressure
    score = Math.min(score, 100);
    let motivationClass = 'COLD';
    if (score >= 70) motivationClass = 'HOT';
    else if (score >= 40) motivationClass = 'WARM';
    return { motivationScore: score, motivationClass };
}

// ==========================================
// Code Violation Lookup (Miami-Dade & Orlando)
// ==========================================
async function checkCodeViolation(address, city) {
    const cityUpper = (city || '').toUpperCase();
    try {
        // Miami-Dade County
        if (cityUpper.includes('MIAMI') || cityUpper.includes('HIALEAH') || cityUpper.includes('CORAL GABLES') ||
            cityUpper.includes('HOMESTEAD') || cityUpper.includes('DORAL') || cityUpper.includes('KENDALL')) {
            const addr = encodeURIComponent(address.toUpperCase());
            const url = `https://services1.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/CodeComplianceViolations/FeatureServer/0/query?where=UPPER(VIOLATION_ADDRESS)+LIKE+'%25${addr.substring(0,20)}%25'&outFields=CASE_NUMBER,STATUS&resultRecordCount=1&f=json`;
            const r = await fetch(url, { timeout: 4000 });
            if (r.ok) {
                const d = await r.json();
                return !!(d.features && d.features.length > 0 && d.features[0].attributes.STATUS !== 'CLOSED');
            }
        }
        // City of Orlando
        if (cityUpper.includes('ORLANDO')) {
            const addr = address.replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase().split(' ').slice(0, 3).join(' ');
            const url = `https://data.cityoforlando.net/resource/k6e8-nw6w.json?$where=upper(address)like'%25${encodeURIComponent(addr)}%25'&$limit=1`;
            const r = await fetch(url, { timeout: 4000 });
            if (r.ok) {
                const d = await r.json();
                return Array.isArray(d) && d.length > 0;
            }
        }
    } catch (e) {
        // Code violation lookup is best-effort — never block the main flow
    }
    return false;
}

// ==========================================
// Demo Data Fallback (Tampa FL 33610)
// ==========================================
function buildDemoResponse() {
    const raw = [
        {
            address: '4812 N 22nd St',       ownerName: 'Marcus T. Williams',
            equityPercent: 72, estimatedValue: 214000, loanBalance: 59920,
            isAbsenteeOwner: true,  yearsOwned: 14, isPreForeclosure: false, isTaxDelinquent: true,
        },
        {
            address: '3107 E Hillsborough Ave', ownerName: 'Sandra R. Perez',
            equityPercent: 85, estimatedValue: 189500, loanBalance: 28425,
            isAbsenteeOwner: true,  yearsOwned: 18, isPreForeclosure: true,  isTaxDelinquent: false,
        },
        {
            address: '5520 N Florida Ave',    ownerName: 'James A. Robinson',
            equityPercent: 61, estimatedValue: 231000, loanBalance: 90090,
            isAbsenteeOwner: false, yearsOwned: 11, isPreForeclosure: true,  isTaxDelinquent: true,
        },
        {
            address: '2241 E Osborne Ave',    ownerName: 'Linda M. Carter',
            equityPercent: 44, estimatedValue: 175000, loanBalance: 98000,
            isAbsenteeOwner: true,  yearsOwned: 7,  isPreForeclosure: false, isTaxDelinquent: false,
        },
        {
            address: '6830 N 40th St',        ownerName: 'Robert D. Thompson',
            equityPercent: 55, estimatedValue: 198000, loanBalance: 89100,
            isAbsenteeOwner: false, yearsOwned: 12, isPreForeclosure: false, isTaxDelinquent: true,
        },
        {
            address: '1924 E Broad St',       ownerName: 'Patricia J. Nguyen',
            equityPercent: 33, estimatedValue: 162000, loanBalance: 108540,
            isAbsenteeOwner: true,  yearsOwned: 5,  isPreForeclosure: false, isTaxDelinquent: false,
        },
        {
            address: '4401 N Rome Ave',       ownerName: 'Charles E. Davis',
            equityPercent: 78, estimatedValue: 245000, loanBalance: 53900,
            isAbsenteeOwner: false, yearsOwned: 21, isPreForeclosure: true,  isTaxDelinquent: false,
        },
        {
            address: '3355 E Lake Ave',       ownerName: 'Dorothy L. Martinez',
            equityPercent: 20, estimatedValue: 155000, loanBalance: 124000,
            isAbsenteeOwner: false, yearsOwned: 3,  isPreForeclosure: false, isTaxDelinquent: false,
        },
    ];

    const leads = raw.map((p, i) => {
        const { motivationScore, motivationClass } = calcMotivationScore(p);
        return {
            _id: `demo-${i}`,
            address: p.address,
            city: 'Tampa',
            state: 'FL',
            zip: '33610',
            ownerName: p.ownerName,
            ownerPhone: '5127775555',
            equityPercent: p.equityPercent,
            estimatedValue: p.estimatedValue,
            loanBalance: p.loanBalance,
            isAbsenteeOwner: p.isAbsenteeOwner,
            yearsOwned: p.yearsOwned,
            isPreForeclosure: p.isPreForeclosure,
            isTaxDelinquent: p.isTaxDelinquent,
            propertyType: 'SFR',
            motivationScore,
            motivationClass,
            attomId: null,
            source: 'DEMO',
            status: 'new',
            isDemo: true,
        };
    });

    leads.sort((a, b) => b.motivationScore - a.motivationScore);
    return { count: leads.length, leads, isDemo: true };
}

// ==========================================
// POST /api/leads/search — Fetch from Florida Public Records + score
// ==========================================
router.post('/search', auth, async (req, res) => {
    const {
        zipCode,
        propertyType,
        minEquity = 30,
        absenteeOwner,
        preForeclosure,
        taxDelinquent
    } = req.body;

    if (!zipCode) {
        return res.status(400).json({ error: 'Zip code is required.' });
    }

    try {
        const currentYear = new Date().getFullYear();

        // Cache disabled temporarily — always fetch fresh from ArcGIS
        // (re-enable after confirming new fields work)
        console.log(`[CACHE] Skipping cache — fetching fresh from ArcGIS for zip ${zipCode}`);

        // ── Fetch fresh from Florida Statewide Cadastral ArcGIS ─────────────
        const arcgisParams = new URLSearchParams({
            where: `PHY_ZIPCD='${zipCode}'`,
            outFields: '*',
            returnGeometry: 'false',
            resultRecordCount: '500',
            f: 'json'
        });

        console.log(`[FL-ARCGIS] Searching zip ${zipCode}...`);

        const arcgisRes = await fetch(
            `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query?${arcgisParams.toString()}`,
            { headers: { 'Accept': 'application/json' } }
        );

        if (!arcgisRes.ok) {
            const status = arcgisRes.status;
            console.error('[FL-ARCGIS ERROR]', status);
            return res.status(429).json({
                error: 'rate_limited',
                message: 'ArcGIS is temporarily unavailable. Please wait 3–5 minutes and try again.'
            });
        }

        const arcgisData = await arcgisRes.json();

        if (arcgisData.error) {
            console.error('[FL-ARCGIS ERROR]', JSON.stringify(arcgisData.error));
            // ArcGIS returns 200 with error body when rate limited or query fails
            return res.status(429).json({
                error: 'rate_limited',
                message: 'ArcGIS is temporarily unavailable. Please wait 3–5 minutes and try again.'
            });
        }

        const features = (arcgisData.features || []).slice(0, 500);
        console.log(`[FL-ARCGIS] Got ${features.length} properties for zip ${zipCode}`);

        // Debug: log ALL field names and values for sqft/bed/bath/year candidates
        if (features.length > 0) {
            const s = features[0].attributes || {};
            console.log(`[FL-ARCGIS DEBUG] All fields: ${Object.keys(s).join(', ')}`);
            console.log(`[FL-ARCGIS DEBUG] sqft candidates: TOT_LVG_AR=${s.TOT_LVG_AR} LVG_AREA=${s.LVG_AREA} LIVING_SQ_FT=${s.LIVING_SQ_FT} LIVING_AREA=${s.LIVING_AREA} SQ_FT=${s.SQ_FT} SQFT=${s.SQFT}`);
            console.log(`[FL-ARCGIS DEBUG] bed candidates: NO_BEDRM=${s.NO_BEDRM} BEDRM=${s.BEDRM} BEDROOMS=${s.BEDROOMS} NUM_BEDRM=${s.NUM_BEDRM} BED=${s.BED}`);
            console.log(`[FL-ARCGIS DEBUG] bath candidates: NO_BATH=${s.NO_BATH} BATHROOMS=${s.BATHROOMS} NUM_BATH=${s.NUM_BATH} BATH=${s.BATH}`);
            console.log(`[FL-ARCGIS DEBUG] year candidates: ACT_YR_BLT=${s.ACT_YR_BLT} YR_BLT=${s.YR_BLT} YEAR_BLT=${s.YEAR_BLT} YEAR_BUILT=${s.YEAR_BUILT} EFF_YR_BLT=${s.EFF_YR_BLT}`);
        }

        if (features.length === 0) {
            console.warn('[FL-ARCGIS] No properties found for zip', zipCode);
            return res.json({ count: 0, leads: [], source: 'FL-PUBLIC', message: `No residential properties found in zip ${zipCode}. This area may be primarily commercial or investor-owned. Try an adjacent zip code.` });
        }

        const leads = [];
        const seenAddresses = new Set(); // deduplicate by address within this batch

        // Skip corporate/government/institutional owners
        const SKIP_KEYWORDS = [
            ' LLC', ' INC', ' CORP', ' LP', ' L.P.',
            ' LL ',  // truncated LLC mid-name
            ' LL',   // truncated LLC at end of name (ArcGIS 30-char cutoff)
            'INVESTMENT', 'RENTAL', 'HOLDINGS', 'VENTURES', 'FUND', 'CAPITAL',
            'MANAGEMENT', 'PROPERTY MGT', 'PROPERTIES GROUP',
            'CAPITAL GROUP', 'CAPITAL LLC',
            'ELECTRIC', 'UTILITIES', 'UTILITY',
            'COMMUNICATION', 'SERVICES', 'SERVIC',
            'COMPANY', ' CO ', 'CONTRACTOR', 'CONTR',
            'AND SON', 'AND SONS', '& SON', '& SONS',
            'COMMUNITY', 'ASSOCIATION', 'HOMEOWNERS', 'HOMEO',
            'RESERVE OF', 'VILLAGES OF', 'PRESERVE AT',
            'TOWNHOME', 'TOWNHOUSE', 'CONDO', 'CONDOMINIUM',
            'TRUSTEE', 'TRUST CO',
            'CITY OF', 'COUNTY OF', 'STATE OF', 'UNITED STATES', 'COUNTY',
            'AUTHORITY', 'TRANSIT', 'DISTRICT', 'DEPARTMENT',
            'CHURCH', 'SCHOOL', 'UNIVERSITY', 'DIOCESE',
            'HABITAT FOR HUMANITY', 'HOUSING AUTHORITY',
            'LIFE ESTATE', 'LIFE ES', 'ESTATE OF',
            'LAND TRUST', ' TRUST',
            'APARTMENT', 'APARTMEN', 'GARDEN APT', 'MOBILE HOME',
            'HOM ', 'HOM$', // truncated HOMEOWNERS / HOMES (ArcGIS 30-char limit)
        ];

        for (const feature of features) {
            const a = feature.attributes || {};

            // DOR_UC: Florida Dept of Revenue Use Codes
            // 0 = vacant residential, 1-9 = residential types, 10+ = non-residential
            const dorUC = a.DOR_UC != null ? parseInt(a.DOR_UC, 10) : null;
            if (dorUC !== null && (dorUC < 0 || dorUC > 9)) continue;
            const isVacant = dorUC === 0;

            // Must have a physical address
            if (!a.PHY_ADDR1 || !a.PHY_ADDR1.trim()) continue;

            // Market value (Just Value) — skip anything under $30k (bad data / non-residential remnants)
            const estimatedValue = a.JV || 0;
            if (estimatedValue < 30000) continue;

            // Skip obvious corporate/government owners
            const rawOwnerName = (a.OWN_NAME || '').toUpperCase();
            if (!rawOwnerName) continue;
            if (SKIP_KEYWORDS.some(kw => rawOwnerName.includes(kw))) continue;

            // Years owned (default to 5 if no sale year recorded)
            const saleYear = a.SALE_YR1 || 0;
            const yearsOwned = saleYear > 0 ? currentYear - saleYear : 5;

            // Equity calculation
            const lastSalePrice = a.SALE_PRC1 || 0;
            let loanBalance, equityPercent;

            if (lastSalePrice >= 5000) {
                // Reliable sale price — 30yr mortgage model, cap at 95%
                loanBalance = Math.max(0, Math.round(lastSalePrice * Math.max(0, (30 - yearsOwned) / 30)));
                equityPercent = Math.min(95, Math.round(((estimatedValue - loanBalance) / estimatedValue) * 100));
            } else {
                // No reliable sale price — estimate equity tier from years owned
                if (yearsOwned >= 20)      equityPercent = 75;
                else if (yearsOwned >= 10) equityPercent = 55;
                else if (yearsOwned >= 5)  equityPercent = 45;
                else                       equityPercent = 35;
                loanBalance = Math.round(estimatedValue * (1 - equityPercent / 100));
            }

            // Absentee owner: owner mailing zip differs from property zip
            const ownerZip = (a.OWN_ZIPCD || '').toString().substring(0, 5);
            const propZip = (a.PHY_ZIPCD || zipCode).toString().substring(0, 5);
            const isAbsenteeOwner = ownerZip.length === 5 && ownerZip !== propZip;

            // Not available in free dataset
            const isTaxDelinquent = false;

            // Check foreclosure database for this address
            const normAddr = normaliseAddress(a.PHY_ADDR1 || '');
            const foreclosureMatch = normAddr ? await ForeclosureRecord.findOne({
                propertyAddress: { $regex: normAddr.split(' ').slice(0, 3).join(' '), $options: 'i' },
                zip: zipCode
            }).lean() : null;
            const isPreForeclosure = !!foreclosureMatch;

            // Senior homestead exemption (Florida Statute 196.075)
            // ArcGIS field EXMPT_38 corresponds to DOR exemption code 38 (senior exemption)
            const seniorExemptRaw = a.EXMPT_38 ?? a.SEN_HMSTD ?? a.SENIOR_EXMPT ?? null;
            const hasSeniorExempt = seniorExemptRaw != null && Number(seniorExemptRaw) > 0;
            // Heuristic fallback: long-term owner + very high equity suggests senior
            const isSeniorOwner = hasSeniorExempt || (yearsOwned >= 20 && equityPercent >= 65);

            // Code violation lookup (best-effort, Miami-Dade & Orlando only)
            const city = a.PHY_CITY || '';
            const hasCodeViolation = await checkCodeViolation(a.PHY_ADDR1 || '', city);

            // Apply filters
            if (equityPercent < minEquity) continue;
            if (absenteeOwner === true && !isAbsenteeOwner) continue;
            if (preForeclosure === true && !isPreForeclosure) continue;
            if (taxDelinquent === true) continue;  // not available yet

            const { motivationScore, motivationClass } = calcMotivationScore({
                equityPercent, isAbsenteeOwner, yearsOwned, isPreForeclosure, isTaxDelinquent,
                isSeniorOwner, isVacant, hasCodeViolation
            });

            // Try all known FDOR NAL field name variants (ArcGIS layer may differ by export)
            const rawSqft = a.TOT_LVG_AR ?? a.LIVING_SQ_FT ?? a.LVG_AREA ?? a.LIVING_AREA ?? a.SQ_FT ?? a.SQFT ?? 0;
            const rawBeds = a.NO_BEDRM ?? a.BEDRM ?? a.BEDROOMS ?? a.NUM_BEDRM ?? a.BED ?? 0;
            const rawBaths = a.NO_BATH ?? a.BATHROOMS ?? a.NUM_BATH ?? a.BATH ?? 0;
            const rawYear = a.ACT_YR_BLT ?? a.YR_BLT ?? a.YEAR_BLT ?? a.YEAR_BUILT ?? a.EFF_YR_BLT ?? 0;

            const sqft = rawSqft > 0 ? Math.round(rawSqft) : null;
            const beds = rawBeds > 0 ? Math.round(rawBeds) : null;
            const baths = rawBaths > 0 ? Math.round(rawBaths * 2) / 2 : null;
            const yearBuilt = rawYear > 1800 ? Math.round(rawYear) : null;

            // Deduplicate: skip if we already have this address in this batch
            const addrKey = (a.PHY_ADDR1 || '').trim().toUpperCase();
            if (seenAddresses.has(addrKey)) continue;
            seenAddresses.add(addrKey);

            const leadData = {
                address: a.PHY_ADDR1 || '',
                city: a.PHY_CITY || '',
                state: 'FL',
                zip: zipCode,
                ownerName: a.OWN_NAME || 'Unknown',
                ownerPhone: null,
                equityPercent,
                estimatedValue,
                loanBalance,
                isAbsenteeOwner,
                yearsOwned,
                isPreForeclosure,
                isTaxDelinquent,
                isSeniorOwner,
                isVacant,
                hasCodeViolation,
                dorUC: dorUC,
                propertyType: propertyType || 'SFR',
                motivationScore,
                motivationClass,
                attomId: a.PARCEL_ID || null,
                source: 'FL-PUBLIC',
                sqft,
                beds,
                baths,
                yearBuilt,
            };

            leads.push(leadData);
        }

        // Upsert by address+zip to prevent duplicates across repeated searches
        if (leads.length > 0) {
            const ops = leads.map(l => ({
                updateOne: {
                    filter: { address: l.address, zip: l.zip, source: 'FL-PUBLIC' },
                    update: { $set: l },
                    upsert: true,
                }
            }));
            await Lead.bulkWrite(ops, { ordered: false }).catch(() => {});
        }

        leads.sort((a, b) => b.motivationScore - a.motivationScore);
        console.log(`[FL-ARCGIS] Returning ${leads.length} scored leads`);
        res.json({ count: leads.length, leads, source: 'FL-PUBLIC' });

    } catch (err) {
        console.error('[SEARCH ERROR]', err);
        res.status(500).json({ error: 'Search failed.', detail: err.message });
    }
});

// ==========================================
// DELETE /api/leads/cache — Wipe cached FL-PUBLIC leads (force re-fetch)
// ==========================================
router.delete('/cache', auth, async (req, res) => {
    try {
        const result = await Lead.deleteMany({ source: 'FL-PUBLIC' });
        res.json({ success: true, deleted: result.deletedCount });
    } catch (err) {
        res.status(500).json({ error: 'Cache clear failed.', detail: err.message });
    }
});

// ==========================================
// GET /api/leads/debug-fields?zip=33612 — Show raw ArcGIS field names in browser
// ==========================================
router.get('/debug-fields', async (req, res) => {
    const zip = req.query.zip || '33612';
    try {
        const params = new URLSearchParams({
            where: `PHY_ZIPCD='${zip}'`,
            outFields: '*',
            returnGeometry: 'false',
            resultRecordCount: '1',
            f: 'json'
        });
        const r = await fetch(
            `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query?${params.toString()}`,
            { headers: { 'Accept': 'application/json' } }
        );
        const data = await r.json();
        if (data.error) return res.json({ error: data.error });
        const attrs = (data.features?.[0]?.attributes) || {};
        const rows = Object.entries(attrs).map(([k, v]) => `<tr><td style="padding:4px 12px;border-bottom:1px solid #2d2d4e;font-family:monospace;color:#a78bfa">${k}</td><td style="padding:4px 12px;border-bottom:1px solid #2d2d4e;color:#e2e8f0">${v ?? '<span style="color:#64748b">null</span>'}</td></tr>`).join('');
        res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>ArcGIS Fields</title></head><body style="background:#0f0f1a;color:#e2e8f0;font-family:sans-serif;padding:32px">
            <h2 style="color:#a78bfa">ArcGIS Field Names — Zip ${zip}</h2>
            <p style="color:#94a3b8">First property returned. Look for beds, baths, sqft, year built.</p>
            <table style="border-collapse:collapse;min-width:500px"><tr><th style="text-align:left;padding:6px 12px;color:#64748b;font-size:12px">FIELD NAME</th><th style="text-align:left;padding:6px 12px;color:#64748b;font-size:12px">VALUE</th></tr>${rows}</table>
        </body></html>`);
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

// ==========================================
// GET /api/leads/clear-cache?key=SECRET — Browser-friendly cache clear (no frontend needed)
// ==========================================
router.get('/clear-cache', async (req, res) => {
    const secret = process.env.CACHE_CLEAR_KEY || 'distress2024';
    if (req.query.key !== secret) {
        return res.status(403).send('<html><body style="font-family:sans-serif;padding:40px;background:#0f0f1a;color:#ef4444"><h2>❌ Invalid key</h2></body></html>');
    }
    try {
        const result = await Lead.deleteMany({ source: 'FL-PUBLIC' });
        res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#0f0f1a;color:#e2e8f0;text-align:center;margin-top:80px">
            <div style="font-size:48px;margin-bottom:16px">✅</div>
            <h2 style="color:#a78bfa;margin:0 0 12px">Cache Cleared!</h2>
            <p style="color:#94a3b8">Deleted <strong style="color:#fff">${result.deletedCount}</strong> cached leads.</p>
            <p style="color:#94a3b8">Go back to the app and run a fresh search to pull new data from ArcGIS.</p>
            <a href="/" style="display:inline-block;margin-top:24px;padding:10px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">← Back to App</a>
        </body></html>`);
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

// ==========================================
// GET /api/leads — Return all saved leads
// ==========================================
router.get('/', auth, async (req, res) => {
    try {
        const leads = await Lead.find().sort({ motivationScore: -1 });
        res.json({ count: leads.length, leads });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch leads.' });
    }
});

// ==========================================
// POST /api/leads/:id/send-to-alisha
// ==========================================
router.post('/:id/send-to-alisha', auth, async (req, res) => {
    try {
        // Handle both real MongoDB leads and demo leads
        let lead;
        if (req.params.id.startsWith('demo-')) {
            const demoData = buildDemoResponse();
            const idx = parseInt(req.params.id.split('-')[1]);
            lead = demoData.leads[idx] || null;
        } else {
            lead = await Lead.findById(req.params.id);
        }
        if (!lead) return res.status(404).json({ error: 'Lead not found.' });

        // ── Skip trace on demand if no phone yet ─────────────────────────────
        let phone = (lead.ownerPhone || '').replace(/\D/g, '');
        let skipped = false;

        if (phone.length !== 10 && !lead.isDemo) {
            console.log(`[ALISHA] No phone on file — skip tracing ${lead.address}...`);
            const traced = await skipTraceLead({
                address: lead.address,
                city: lead.city,
                state: lead.state || 'FL',
                ownerName: lead.ownerName
            });

            if (traced && traced.phone) {
                phone = traced.phone;
                // Persist back to the lead so future clicks don't cost another $0.02
                if (lead._id && !lead.isDemo) {
                    await Lead.findByIdAndUpdate(lead._id, {
                        ownerPhone: phone,
                        ownerEmail: traced.email || lead.ownerEmail || null
                    });
                }
                console.log(`[ALISHA] Skip trace found phone: ${phone}`);
            } else {
                skipped = true;
                phone = '5127775555'; // fallback — no number found
                console.warn('[ALISHA] Skip trace returned no phone — using fallback');
            }
        }

        const payload = {
            name: lead.ownerName,
            address: lead.address,
            phone,
            source: 'Distress Filter'
        };

        console.log('[ALISHA] Sending payload:', JSON.stringify(payload));

        let alishaRes;
        try {
            alishaRes = await fetch('https://alisha-ai-caller-production.up.railway.app/api/webhook/propwire', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (networkErr) {
            console.error('[ALISHA] Network error — is the Alisha server running on port 3000?', networkErr.message);
            return res.status(502).json({
                error: 'Could not reach Alisha server.',
                detail: networkErr.message
            });
        }

        const responseBody = await alishaRes.text();

        if (!alishaRes.ok) {
            console.error(
                `[ALISHA] HTTP ${alishaRes.status} from webhook\n` +
                `  Payload sent: ${JSON.stringify(payload)}\n` +
                `  Response body: ${responseBody}`
            );
            return res.status(502).json({
                error: `Alisha webhook returned ${alishaRes.status}`,
                detail: responseBody
            });
        }

        console.log(`[ALISHA] Success for lead ${lead._id} — response: ${responseBody}`);

        lead.status = 'sent_to_alisha';
        await lead.save();

        let alishaData;
        try {
            alishaData = JSON.parse(responseBody);
        } catch {
            alishaData = { raw: responseBody };
        }

        res.json({ success: true, alisha: alishaData });
    } catch (err) {
        console.error('[ALISHA] Unexpected error:', err);
        res.status(500).json({ error: 'Failed to send to Alisha.', detail: err.message });
    }
});

// ==========================================
// GET /api/leads/export — CSV download
// ==========================================
router.get('/export', auth, async (req, res) => {
    try {
        const leads = await Lead.find().sort({ motivationScore: -1 }).lean();

        const fields = [
            'address', 'city', 'state', 'zip',
            'ownerName', 'ownerPhone',
            'equityPercent', 'estimatedValue', 'loanBalance',
            'isAbsenteeOwner', 'yearsOwned',
            'isPreForeclosure', 'isTaxDelinquent',
            'propertyType', 'motivationScore', 'motivationClass', 'status'
        ];

        const parser = new Parser({ fields });
        const csv = parser.parse(leads);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="distress-filter-leads.csv"');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: 'Export failed.' });
    }
});

// ==========================================
// PATCH /api/leads/:id — Update status
// ==========================================
router.patch('/:id', auth, async (req, res) => {
    try {
        const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!lead) return res.status(404).json({ error: 'Lead not found.' });
        res.json({ success: true, lead });
    } catch (err) {
        res.status(500).json({ error: 'Update failed.' });
    }
});

// ==========================================
// DELETE /api/leads/:id
// ==========================================
router.delete('/:id', auth, async (req, res) => {
    try {
        await Lead.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Delete failed.' });
    }
});

module.exports = router;
