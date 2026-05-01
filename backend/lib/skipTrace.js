/**
 * On-demand skip tracing via Tracerfy
 * Called only when user clicks "Send to Alisha" — $0.02 per lead
 * API docs: https://www.tracerfy.com/skip-tracing-api-documentation/
 */
const fetch = require('node-fetch');

const TRACERFY_API_URL = 'https://tracerfy.com/v1/api/trace/lookup/';

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
            find_owner: true
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
            const errBody = await resp.text();
            console.warn(`[SKIPTRACE] HTTP ${resp.status} from Tracerfy:`, errBody.substring(0, 200));
            return null;
        }

        const data = await resp.json();
        console.log('[SKIPTRACE] Raw response:', JSON.stringify(data).substring(0, 300));

        // Tracerfy returns { hit, persons: [...] }
        if (!data.hit) {
            console.warn('[SKIPTRACE] No hit for', address);
            return null;
        }

        const people = data.persons || [];
        if (people.length === 0) {
            console.warn('[SKIPTRACE] No persons returned for', address);
            return null;
        }

        const person = people[0];
        console.log('[SKIPTRACE] Person keys:', Object.keys(person).join(', '));

        // Extract phones — Tracerfy stores as array of objects with phone_number field
        const rawPhones = person.phones || person.phone_numbers || person.phone || [];
        const phones = (Array.isArray(rawPhones) ? rawPhones : [rawPhones])
            .map(p => typeof p === 'string' ? p : (p.phone_number || p.number || p.phone || ''))
            .map(p => p.replace(/\D/g, ''))
            .filter(p => p.length === 10);

        // Extract emails — Tracerfy stores as array of objects with email field
        const rawEmails = person.emails || person.email_addresses || person.email || [];
        const emails = (Array.isArray(rawEmails) ? rawEmails : [rawEmails])
            .map(e => typeof e === 'string' ? e : (e.email_address || e.email || e.address || ''))
            .filter(e => e && e.includes('@'));

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
