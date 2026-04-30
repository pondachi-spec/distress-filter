const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const Lead = require('../models/Lead');
const auth = require('../middleware/auth');
const { Parser } = require('json2csv');

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
    score = Math.min(score, 100);
    let motivationClass = 'COLD';
    if (score >= 70) motivationClass = 'HOT';
    else if (score >= 40) motivationClass = 'WARM';
    return { motivationScore: score, motivationClass };
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

        // ---- Florida Statewide Cadastral ArcGIS API (free, no key needed) ----
        // DOR_UC 1-9 = residential; filter applied in JS since ArcGIS rejects numeric WHERE comparison
        const arcgisParams = new URLSearchParams({
            where: `PHY_ZIPCD='${zipCode}'`,
            outFields: 'PARCEL_ID,OWN_NAME,OWN_ZIPCD,PHY_ADDR1,PHY_CITY,PHY_ZIPCD,JV,SALE_PRC1,SALE_YR1,DOR_UC',
            returnGeometry: 'false',
            f: 'json'
        });

        console.log(`[FL-ARCGIS] Searching zip ${zipCode}...`);

        const arcgisRes = await fetch(
            `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query?${arcgisParams.toString()}`,
            { headers: { 'Accept': 'application/json' } }
        );

        if (!arcgisRes.ok) {
            console.error('[FL-ARCGIS ERROR]', arcgisRes.status);
            return res.json(buildDemoResponse());
        }

        const arcgisData = await arcgisRes.json();

        if (arcgisData.error) {
            console.error('[FL-ARCGIS ERROR]', arcgisData.error);
            return res.json(buildDemoResponse());
        }

        const features = arcgisData.features || [];
        console.log(`[FL-ARCGIS] Got ${features.length} properties for zip ${zipCode}`);

        if (features.length === 0) {
            console.warn('[FL-ARCGIS] No properties found — returning demo data');
            return res.json(buildDemoResponse());
        }

        // Clear stale leads for this zip so recalculated equity is always fresh
        await Lead.deleteMany({ zip: zipCode, source: 'FL-PUBLIC' });

        const leads = [];

        // Skip corporate/government/institutional owners
        const SKIP_KEYWORDS = [
            ' LLC', ' INC', ' CORP', ' LP', ' L.P.',
            ' LL ',  // truncated LLC (ArcGIS cuts long names)
            'INVESTMENT', 'RENTAL', 'HOLDINGS', 'VENTURES',
            'MANAGEMENT', 'PROPERTY MGT', 'PROPERTIES GROUP',
            'CAPITAL GROUP', 'CAPITAL LLC',
            'ELECTRIC', 'UTILITIES', 'UTILITY',
            'TRUSTEE', 'TRUST CO',
            'CITY OF', 'COUNTY OF', 'STATE OF', 'UNITED STATES',
            'CHURCH', 'SCHOOL', 'UNIVERSITY',
            'HABITAT FOR HUMANITY', 'HOUSING AUTHORITY',
            'LIFE ESTATE', 'ESTATE OF'
        ];

        for (const feature of features) {
            const a = feature.attributes || {};

            // Market value (Just Value)
            const estimatedValue = a.JV || 0;
            if (estimatedValue === 0) continue;

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
            const isPreForeclosure = false;
            const isTaxDelinquent = false;

            // Apply filters
            if (equityPercent < minEquity) continue;
            if (absenteeOwner === true && !isAbsenteeOwner) continue;
            if (preForeclosure === true) continue; // not available
            if (taxDelinquent === true) continue;  // not available

            const { motivationScore, motivationClass } = calcMotivationScore({
                equityPercent, isAbsenteeOwner, yearsOwned, isPreForeclosure, isTaxDelinquent
            });

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
                propertyType: propertyType || 'SFR',
                motivationScore,
                motivationClass,
                attomId: a.PARCEL_ID || null,
                source: 'FL-PUBLIC'
            };

            // Upsert into MongoDB
            const saved = await Lead.findOneAndUpdate(
                { attomId: leadData.attomId || leadData.address },
                leadData,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            leads.push(saved);
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

        // Strip all non-digits, use fallback if not 10 digits
        const rawPhone = (lead.ownerPhone || '').replace(/\D/g, '');
        const phone = rawPhone.length === 10 ? rawPhone : '5127775555';

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
