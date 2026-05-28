/**
 * migrate_answer_conflict_columns.js
 *
 * Additive, idempotent migration for the Answer-Key Conflict Resolution queue.
 * Adds verdict / audit columns to question_version. Safe to re-run.
 *
 *   final_correct_option_label TEXT          -- 'A'|'B'|'C'|'D' (NULL while unresolved / needs_expert)
 *   final_answer_source        TEXT          -- conflict_resolved_solution | conflict_resolved_pdf
 *                                               | conflict_resolved_other | needs_expert
 *   final_resolved_by          INTEGER       -- users.id (serial)
 *   final_resolved_at          TIMESTAMPTZ
 *   final_resolution_history   JSONB         -- append-only audit trail of every verdict
 *
 * Usage:
 *   node scripts/migrate_answer_conflict_columns.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const DDL = `
ALTER TABLE question_version
    ADD COLUMN IF NOT EXISTS final_correct_option_label TEXT,
    ADD COLUMN IF NOT EXISTS final_answer_source        TEXT,
    ADD COLUMN IF NOT EXISTS final_resolved_by          INTEGER,
    ADD COLUMN IF NOT EXISTS final_resolved_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS final_resolution_history   JSONB;
`;

async function run() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(DDL);
        await client.query('COMMIT');

        const check = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'question_version'
              AND column_name IN (
                'final_correct_option_label','final_answer_source',
                'final_resolved_by','final_resolved_at','final_resolution_history'
              )
            ORDER BY column_name
        `);
        console.log('✅ Migration applied. Columns now present:');
        check.rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', e.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
