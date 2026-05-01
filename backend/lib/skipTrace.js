/**
 * On-demand skip tracing via Tracerfy
 * Called only when user clicks "Send to Alisha" — $0.02 per lead
 * API docs: https://www.tracerfy.com/skip-tracing-api-documentation/
 */
const fetch = require('node-fetch');

const TRACERFY_API_URL = 'https://tracerfy.com/v1/api/trace/';

/**
 * Skip trace a single lead by address.
 * Returns { phone, email, allPhones, allEmails } or null if not found / no API key.
 */
async function skipTraceLead({ address, city, state = 'FL', ownerName }) {
    const apiKey = process.env.TRACERFY_API_KEY;

    if (!apiKey) {
        console.warn('[SKIPTRACE] No TRACERFY_API_KEY set — skipping');
        return null;
    }

    try {
        const payload = {
            address,
            city: city || 'TAMPA',
            state,
            find_owner: true   // send address → get back owner phones/emails
        };

        console.log(`[SKIPTRACE] Tracing ${address}, ${city}, ${state}...`);

        const resp = await fetch(TRACERFY_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload),
            timeout: 15000
        });

        if (!resp.ok) {
            console.warn(`[SKIPTRACE] HTTP ${resp.status} from Tracerfy`);
            return null;
        }

        const data = await resp.json();
        console.log('[SKIPTRACE] Raw response:', JSON.stringify(data).substring(0, 300));

        // Tracerfy returns an array of people — pick the first match
        const people = Array.isArray(data) ? data : (data.results || data.data || []);
        if (!people || people.length === 0) {
            console.warn('[SKIPTRACE] No results returned for', address);
            return null;
        }

        const person = people[0];

        // Extract phones — ranked list, prefer mobile/cell
        const phones = (person.phones || person.phone_numbers || [])
            .map(p => typeof p === 'string' ? p : (p.number || p.phone || ''))
            .map(p => p.replace(/\D/g, ''))
            .filter(p => p.length === 10);

        // Extract emails
        const emails = (person.emails || person.email_addresses || [])
            .map(e => typeof e === 'string' ? e : (e.email || e.address || ''))
            .filter(e => e.includes('@'));

        const result = {
            phone: phones[0] || null,
            email: emails[0] || null,
            allPhones: phones,
            allEmails: emails,
            tracedName: person.name || person.full_name || ownerName || null
        };

        console.log(`[SKIPTRACE] Found for ${address}: ${phones.length} phones, ${emails.length} emails`);
        return result;

    } catch (err) {
        console.error('[SKIPTRACE] Error:', err.message);
        return null;
    }
}

module.exports = { skipTraceLead };
