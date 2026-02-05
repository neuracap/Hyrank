
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='exam_section'");
        console.log('exam_section columns:', res.rows.map(r => r.column_name).sort());

        const res2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='paper_session'");
        console.log('paper_session columns:', res2.rows.map(r => r.column_name).sort());
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
