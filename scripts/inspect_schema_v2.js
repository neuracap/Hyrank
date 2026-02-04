const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspect() {
    try {
        console.log('--- Tables containing "assign" ---');
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        const assignTables = tables.rows.filter(r => r.table_name.includes('assign') || r.table_name.includes('user') || r.table_name.includes('review'));
        console.log(assignTables.map(t => t.table_name));

        console.log('\n--- Paper Session Columns ---');
        const schema = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'paper_session'
        `);
        console.log(schema.rows.map(r => r.column_name).join(', '));

        console.log('\n--- Users (first 5) ---');
        const users = await pool.query("SELECT id, email, name FROM users ORDER BY email LIMIT 5");
        users.rows.forEach(u => console.log(`${u.id}: ${u.email}`));

        console.log('\n--- SSC CGL Papers Count ---');
        const count = await pool.query("SELECT COUNT(*) FROM paper_session WHERE name ILIKE '%SSC CGL%'");
        console.log("Total SSC CGL papers:", count.rows[0].count);

        // Check for linked sessions
        console.log('\n--- Linked Sessions Sample ---');
        // We know question_links table links them, but is there a session-level link?
        // Let's check columns of paper_session again.

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
}

inspect();
