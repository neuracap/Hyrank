require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectData() {
    try {
        const client = await pool.connect();

        console.log('\n--- Sample question_version ---');
        const qv = await client.query('SELECT * FROM question_version LIMIT 1');
        if (qv.rows.length > 0) {
            const row = qv.rows[0];
            console.log('Keys:', Object.keys(row));
            console.log('body_json:', JSON.stringify(row.body_json, null, 2));
            console.log('meta_json:', JSON.stringify(row.meta_json, null, 2));
            console.log('solution_json:', JSON.stringify(row.solution_json, null, 2));
        }

        console.log('\n--- paper_session columns ---');
        const ps = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'paper_session'
        `);
        console.log(ps.rows.map(r => r.column_name).join(', '));

        console.log('\n--- exam columns ---');
        const ex = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'exam'
        `);
        console.log(ex.rows.map(r => r.column_name).join(', '));

        client.release();
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

inspectData();
