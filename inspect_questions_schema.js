const pool = require('./lib/db').default;
require('dotenv').config({ path: '.env.local' });

async function inspectSchema() {
    try {
        console.log('--- Inspecting "questions" table schema ---');
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'questions'
            ORDER BY ordinal_position;
        `);
        console.table(res.rows);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
}

inspectSchema();
