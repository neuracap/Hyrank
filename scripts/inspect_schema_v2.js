const db = require('../lib/db');
require('dotenv').config({ path: '.env.local' });

// Mock the pool interface since lib/db likely exports a custom object or pool
// Let's check lib/db content first to be sure how to use it.
// Actually, let's just view lib/db first.

async function inspect() {
    try {
        console.log('--- Listing All Tables ---');
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        console.log(tables.rows.map(t => t.table_name));

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
}

inspect();
