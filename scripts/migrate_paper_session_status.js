const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrateDatabase() {
    try {
        console.log('Starting paper_session schema migration...');

        // 1. Add new column `status`
        console.log('Adding "status" column to paper_session...');
        await pool.query(`
            ALTER TABLE paper_session 
            ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'NOT_REVIEWED';
        `);
        console.log('✅ Added status column.');

        // 2. Data Migration: SET status = 'TEAM_REVIEWED' for questions_reviewed = true
        console.log('Backfilling existing papers into TEAM_REVIEWED status...');
        const backfillRes = await pool.query(`
            UPDATE paper_session 
            SET status = 'TEAM_REVIEWED' 
            WHERE questions_reviewed = TRUE;
        `);
        console.log(`✅ Backfilled ${backfillRes.rowCount} papers.`);

        // 3. Drop legacy columns
        console.log('Dropping legacy columns admin_review and production_approved...');
        await pool.query(`
            ALTER TABLE paper_session 
            DROP COLUMN IF EXISTS admin_review,
            DROP COLUMN IF EXISTS production_approved;
        `);
        console.log('✅ Dropped legacy columns.');

        console.log('✅ paper_session migration complete!');
    } catch (e) {
        console.error('❌ Error during schema migration:', e);
    } finally {
        await pool.end();
    }
}

migrateDatabase();
