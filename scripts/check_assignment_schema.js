const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspect() {
    try {
        console.log('--- Users ---');
        const users = await pool.query("SELECT id, email, name FROM users WHERE email LIKE 'user%@hyrank.com' ORDER BY email LIMIT 5");
        console.table(users.rows);

        console.log('\n--- Paper Session Columns ---');
        const schema = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'paper_session'
        `);
        console.table(schema.rows);

        console.log('\n--- SSC CGL Papers Sample ---');
        // Guessing column names for now, sticking to *
        const papers = await pool.query("SELECT * FROM paper_session WHERE name ILIKE '%SSC CGL%' LIMIT 5");
        // Print just a summary to avoid huge output
        papers.rows.forEach(p => {
            console.log(`ID: ${p.paper_session_id}, Name: ${p.name}, Lang: ${p.language}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

inspect();
