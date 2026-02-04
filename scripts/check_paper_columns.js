const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    try {
        console.log('Checking paper_session columns...');
        const res = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'paper_session'
            ORDER BY column_name
        `);
        console.log(res.rows.map(r => r.column_name).join('\n'));

        const hasCol = res.rows.some(r => r.column_name === 'questions_reviewed');
        console.log(`\nHas 'questions_reviewed' column? ${hasCol ? 'YES' : 'NO'}`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
check();
