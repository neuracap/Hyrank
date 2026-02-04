const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function dump() {
    try {
        let output = '';

        // Columns of paper_session
        const schema = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'paper_session'
            ORDER BY ordinal_position
        `);
        output += '--- paper_session columns ---\n';
        schema.rows.forEach(r => output += `${r.column_name} (${r.data_type})\n`);

        // Users
        const users = await pool.query("SELECT id, email FROM users WHERE email LIKE 'user%@hyrank.com' ORDER BY email LIMIT 10");
        output += '\n--- Users ---\n';
        users.rows.forEach(u => output += `${u.id}: ${u.email}\n`);

        fs.writeFileSync('schema_dump.txt', output);
        console.log('Dumped to schema_dump.txt');

    } catch (e) {
        console.error(e);
        fs.writeFileSync('schema_dump.txt', 'Error: ' + e.message);
    } finally {
        await pool.end();
    }
}

dump();
