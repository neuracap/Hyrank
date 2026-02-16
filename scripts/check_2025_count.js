const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkCount() {
    try {
        console.log('Checking 2025 paper counts...');

        // Check raw counts
        const rawCount = await pool.query(`
            SELECT language, COUNT(*) 
            FROM paper_session 
            WHERE EXTRACT(YEAR FROM paper_date) = 2025
            GROUP BY language
        `);
        console.log('Raw counts 2025:', rawCount.rows);

        // Check pairs
        const pairsQuery = `
            SELECT COUNT(*)
            FROM question_links ql
            JOIN paper_session pse ON ql.paper_session_id_english = pse.paper_session_id
            JOIN paper_session psh ON ql.paper_session_id_hindi = psh.paper_session_id
            WHERE EXTRACT(YEAR FROM pse.paper_date) = 2025
        `;

        const pairsRes = await pool.query(pairsQuery);
        console.log('Linked Pairs 2025:', pairsRes.rows[0].count);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkCount();
