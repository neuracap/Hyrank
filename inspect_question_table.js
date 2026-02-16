require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectTable() {
    try {
        const client = await pool.connect();
        console.log('Connected to DB');

        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'question'
            ORDER BY ordinal_position;
        `);

        console.log('Columns in question table:');
        res.rows.forEach(row => console.log(`- ${row.column_name} (${row.data_type})`));

        client.release();
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

inspectTable();
