const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log('Adding questions_reviewed column to paper_session...');
        await pool.query(`
            ALTER TABLE paper_session 
            ADD COLUMN IF NOT EXISTS questions_reviewed BOOLEAN DEFAULT FALSE;
        `);
        console.log('✅ Column added successfully.');
    } catch (e) {
        console.error('❌ Error adding column:', e);
    } finally {
        await pool.end();
    }
}
migrate();
