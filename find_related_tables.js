require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function findTables() {
    try {
        const client = await pool.connect();

        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND (table_name LIKE '%option%' OR table_name LIKE '%solution%')
            ORDER BY table_name;
        `);

        console.log('Related tables:');
        res.rows.forEach(row => console.log(`- ${row.table_name}`));

        client.release();
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

findTables();
