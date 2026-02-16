const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function allocatePapers() {
    let client;
    try {
        client = await pool.connect();
        console.log('Starting 2025 paper allocation...');

        // 1. Get Reviewers
        const reviewersRes = await pool.query(`
            SELECT id, email FROM users 
            WHERE email IN ('user1@hyrank.com', 'user2@hyrank.com', 'user3@hyrank.com', 'user4@hyrank.com', 'user5@hyrank.com')
            ORDER BY email
        `);

        const reviewers = reviewersRes.rows;
        console.log(`Found ${reviewers.length} reviewers:`, reviewers.map(u => u.email).join(', '));

        if (reviewers.length < 5) {
            console.log("Warning: Less than 5 reviewers found. Proceeding with found reviewers.");
            if (reviewers.length === 0) throw new Error("No reviewers found.");
        }

        // 2. Get 2025 Paper Pairs
        console.log('Fetching 2025 paper pairs...');
        const pairsQuery = `
            SELECT DISTINCT 
                ql.paper_session_id_english as eng_id, 
                pse.caption as eng_name,
                ql.paper_session_id_hindi as hin_id,
                psh.caption as hin_name,
                pse.paper_date
            FROM question_links ql
            JOIN paper_session pse ON ql.paper_session_id_english = pse.paper_session_id
            JOIN paper_session psh ON ql.paper_session_id_hindi = psh.paper_session_id
            WHERE EXTRACT(YEAR FROM pse.paper_date) = 2025
            ORDER BY pse.paper_date DESC
        `;
        const pairsRes = await pool.query(pairsQuery);
        const pairs = pairsRes.rows;
        console.log(`Found ${pairs.length} pairs to allocate.`);

        if (pairs.length === 0) {
            console.log("No papers found for 2025.");
            return;
        }

        // 3. Clear old assignments for these papers
        await client.query('BEGIN');

        console.log('Clearing existing assignments for these papers...');
        const allPaperIds = pairs.flatMap(p => [p.eng_id, p.hin_id]);

        // Split delete into chunks if too large (though 86 is fine)
        await client.query(`
            DELETE FROM review_assignments 
            WHERE paper_session_id = ANY($1)
        `, [allPaperIds]);

        // 4. Assign Round Robin
        console.log('Assigning new reviewers...');

        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            const reviewer = reviewers[i % reviewers.length];

            // Assign English
            await client.query(`
                INSERT INTO review_assignments (paper_session_id, reviewer_id, status)
                VALUES ($1, $2, 'PENDING')
            `, [pair.eng_id, reviewer.id]);

            // Assign Hindi
            await client.query(`
                INSERT INTO review_assignments (paper_session_id, reviewer_id, status)
                VALUES ($1, $2, 'PENDING')
            `, [pair.hin_id, reviewer.id]);
        }

        await client.query('COMMIT');
        console.log('✅ Allocation complete!');
        console.log(`Allocated ${pairs.length} pairs (${pairs.length * 2} papers) across ${reviewers.length} reviewers.`);

    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error('Error during allocation:', e);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

allocatePapers();
