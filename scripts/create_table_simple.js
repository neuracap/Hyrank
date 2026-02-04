const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('Creating table...');
        // Removing foreign key constraints locally to isolate specific error if any
        // But we need them. Let's try minimal first.
        await pool.query(`
            CREATE TABLE review_assignments (
                id SERIAL PRIMARY KEY,
                paper_session_id UUID NOT NULL,
                reviewer_id INTEGER NOT NULL,
                assigned_at TIMESTAMP DEFAULT NOW(),
                status TEXT DEFAULT 'PENDING'
            );
        `);
        console.log('✅ Created table (no FKs yet to test).');

        console.log('Adding constraints...');
        await pool.query(`
            ALTER TABLE review_assignments 
            ADD CONSTRAINT fk_paper FOREIGN KEY (paper_session_id) REFERENCES paper_session(paper_session_id),
            ADD CONSTRAINT fk_user FOREIGN KEY (reviewer_id) REFERENCES users(id),
            ADD CONSTRAINT uq_paper UNIQUE (paper_session_id);
        `);
        console.log('✅ Constraints added.');

    } catch (e) {
        console.error('❌ Error:', e.message);
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
