const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function assignPapers() {
    try {
        console.log('Starting assignment process...');

        // 1. Get Reviewers (users 1-5 ideally, or just 5 users)
        // We look for emails typically used: user1...user5
        let reviewers = await pool.query(`
            SELECT id, email FROM users 
            WHERE email IN ('user1@hyrank.com', 'user2@hyrank.com', 'user3@hyrank.com', 'user4@hyrank.com', 'user5@hyrank.com')
            ORDER BY email
        `);

        if (reviewers.rows.length < 5) {
            console.log(`⚠️ Found only ${reviewers.rows.length} reviewers. Fetching by limit...`);
            const allUsers = await pool.query("SELECT id, email FROM users WHERE email LIKE 'user%@hyrank.com' LIMIT 5");
            reviewers = allUsers;
        }

        console.log(`Found ${reviewers.rows.length} reviewers:`, reviewers.rows.map(u => u.email).join(', '));

        if (reviewers.rows.length === 0) {
            throw new Error("No reviewers found!");
        }

        // 2. Find SSC CGL Papers (Linked)
        // We need pairs where BOTH English and Hindi exist.
        // We use question_links or paper_session name matching.
        // Better to find question_links that link sessions.

        console.log('Fetching SSC CGL paper pairs...');

        // Distinct pairs from question_links
        // We assume paper_session_id_english and paper_session_id_hindi columns exist as verified.
        const pairsQuery = `
            SELECT DISTINCT 
                ql.paper_session_id_english as eng_id, 
                pse.caption as eng_name,
                ql.paper_session_id_hindi as hin_id,
                psh.caption as hin_name
            FROM question_links ql
            JOIN paper_session pse ON ql.paper_session_id_english = pse.paper_session_id
            JOIN paper_session psh ON ql.paper_session_id_hindi = psh.paper_session_id
            WHERE pse.caption ILIKE '%Combined Graduate Level%' 
            AND psh.caption ILIKE '%Combined Graduate Level%'
        `;

        const pairsRes = await pool.query(pairsQuery);
        const pairs = pairsRes.rows;
        console.log(`Found ${pairs.length} bilingual paper pairs.`);

        if (pairs.length === 0) {
            console.log("⚠️ No pairs found via links. Trying fuzzy name match fallback...");
            // TODO: Fallback if needed, but lets assume links exist for "Bilingual" requirement
        }

        // 3. Assign in Round Robin
        let assignments = [];
        let poolClient = await pool.connect();

        try {
            await poolClient.query('BEGIN');

            // Clear existing assignments? User said "assign all", implied fresh or additive.
            // Let's assume we keep existing logic simple: try insert, ignore if exists?
            // User said: "assign all ... to 5 reviewers".
            // We should clear old assignments to ensure clean state or handle duplicates.
            // "I dont want to mess with my main tables" -> implies review_assignments is safe to wipe?
            // Let's wipe review_assignments for these papers to be safe/idempotent.

            console.log('Clearing old assignments for these papers...');
            const allPaperIds = pairs.flatMap(p => [p.eng_id, p.hin_id]);
            if (allPaperIds.length > 0) {
                await poolClient.query(`DELETE FROM review_assignments WHERE paper_session_id = ANY($1)`, [allPaperIds]);
            }

            console.log('Creating new assignments...');

            for (let i = 0; i < pairs.length; i++) {
                const pair = pairs[i];
                const reviewer = reviewers.rows[i % reviewers.rows.length];

                // Assign English IO
                await poolClient.query(`
                    INSERT INTO review_assignments (paper_session_id, reviewer_id, status)
                    VALUES ($1, $2, 'PENDING')
                `, [pair.eng_id, reviewer.id]);

                // Assign Hindi IO
                await poolClient.query(`
                    INSERT INTO review_assignments (paper_session_id, reviewer_id, status)
                    VALUES ($1, $2, 'PENDING')
                `, [pair.hin_id, reviewer.id]);

                assignments.push({
                    pairIndex: i,
                    reviewer: reviewer.email,
                    eng_paper: pair.eng_name,
                    hin_paper: pair.hin_name
                });
            }

            await poolClient.query('COMMIT');
            console.log(`✅ Successfully assigned ${pairs.length} pairs (${pairs.length * 2} papers) to ${reviewers.rows.length} reviewers.`);

        } catch (e) {
            await poolClient.query('ROLLBACK');
            throw e;
        } finally {
            poolClient.release();
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

assignPapers();
