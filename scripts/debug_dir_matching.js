const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

// Base dir from the route.js
const baseDir = 'C:\\Users\\Neuraedge\\Documents\\Divya\\MeritEdge\\Code\\adda_ssc\\mathpix_raw_zips';

async function debugMatching() {
    try {
        const client = await pool.connect();

        // Get the most recent question's session info
        // This is likely the one the user was just testing with
        const res = await client.query(`
        SELECT ps.session_label, e.name as exam_name, ps.paper_session_id
        FROM question_version qv
        JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
        JOIN exam e ON ps.exam_id = e.exam_id
        ORDER BY qv.updated_at DESC
        LIMIT 1
    `);

        if (res.rows.length === 0) {
            console.log("No recent questions found using updated_at. Trying created_at.");
            // Fallback
        }

        const { session_label, exam_name } = res.rows[0];
        console.log(`DB INFO:\n  Exam: ${exam_name}\n  Session Label: ${session_label}\n`);

        const sanitize = (str) => str.replace(/[<>:"/\\|?*]/g, '-').trim();
        const examSlug = sanitize(exam_name.toLowerCase().replace(/\s+/g, '-'));
        const examDir = path.join(baseDir, examSlug);

        console.log(`Checking Exam Dir: ${examDir}`);

        if (fs.existsSync(examDir)) {
            const subdirs = fs.readdirSync(examDir);
            console.log(`\nFound ${subdirs.length} subdirectories. Listing first 10 and any that look similar:`);

            const normalize = (s) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const target = normalize(session_label);

            subdirs.slice(0, 10).forEach(d => console.log(`  - ${d}`));

            // Run the Existing Logic
            let foundDir = null;
            const sortedDirs = subdirs.sort((a, b) => b.length - a.length);

            // 1. Exact
            foundDir = sortedDirs.find(d => normalize(d) === target);
            console.log(`\nStrategy 1 (Exact): ${foundDir ? 'MATCH: ' + foundDir : 'No match'}`);

            // 2. Dir is substring of Target
            if (!foundDir) {
                foundDir = sortedDirs.find(d => {
                    const normD = normalize(d);
                    return normD.length > 8 && target.includes(normD);
                });
                console.log(`Strategy 2 (Dir in Label): ${foundDir ? 'MATCH: ' + foundDir : 'No match'}`);
            }

            // 3. Target is substring of Dir
            if (!foundDir) {
                foundDir = sortedDirs.find(d => {
                    const normD = normalize(d);
                    return normalize(d).includes(target);
                });
                console.log(`Strategy 3 (Label in Dir): ${foundDir ? 'MATCH: ' + foundDir : 'No match'}`);
            }

            console.log(`\nFINAL DECISION: ${foundDir ? 'Use ' + foundDir : 'Create NEW: ' + sanitize(session_label)}`);

            // Debug: Show what the normalized versions look like
            console.log(`\nDEBUG COMPARISON:`);
            console.log(`  Target (Normalized Session Label): ${target}`);
            console.log(`  Sanitized Session Label (New Folder Name): ${sanitize(session_label)}`);

        } else {
            console.log("Exam directory does not exist!");
        }

        client.release();
    } catch (err) {
        console.error('Error executing query', err);
    } finally {
        await pool.end();
    }
}

debugMatching();
