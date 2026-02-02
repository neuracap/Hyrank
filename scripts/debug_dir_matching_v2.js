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

const baseDir = 'C:\\Users\\Neuraedge\\Documents\\Divya\\MeritEdge\\Code\\adda_ssc\\mathpix_raw_zips';

async function debugMatching() {
    try {
        const client = await pool.connect();

        // Fetch last updated question to find the session
        const res = await client.query(`
        SELECT ps.session_label, e.name as exam_name
        FROM question_version qv
        JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
        JOIN exam e ON ps.exam_id = e.exam_id
        ORDER BY qv.updated_at DESC
        LIMIT 1
    `);

        const { session_label, exam_name } = res.rows[0];
        const sanitize = (str) => str.replace(/[<>:"/\\|?*]/g, '-').trim();
        const examSlug = sanitize(exam_name.toLowerCase().replace(/\s+/g, '-'));
        const examDir = path.join(baseDir, examSlug);

        console.log(`SESSION: ${session_label}`);

        if (fs.existsSync(examDir)) {
            const subdirs = fs.readdirSync(examDir);
            // Find dirs that contain "26.09.2024" (part of the label we saw) to narrow down list
            const likelyMatches = subdirs.filter(d => d.includes("26.09.2024"));
            console.log(`\nRelevent Directories found (${likelyMatches.length}):`);
            likelyMatches.forEach(d => console.log(`DIR: ${d}`));
        }

        client.release();
    } catch (err) { console.error(err); } finally { await pool.end(); }
}
debugMatching();
