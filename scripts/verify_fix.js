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

async function verifyFix() {
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

        console.log(`Testing Match For: ${session_label}`);

        if (fs.existsSync(examDir)) {
            const subdirs = fs.readdirSync(examDir);

            let foundDir = null;
            // The implementation logic mirrored here
            const normalize = (s) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const target = normalize(session_label);
            const sortedDirs = subdirs.sort((a, b) => b.length - a.length); // Sort long first

            // Strategy 1 (Exact)
            foundDir = sortedDirs.find(d => normalize(d) === target);

            // Strategy 2 (Bracket)
            if (!foundDir) {
                const bracketMatch = session_label.match(/\[(.*?)\]/);
                if (bracketMatch && bracketMatch[1]) {
                    const bracketContent = normalize(bracketMatch[1]);
                    if (bracketContent.length > 5) {
                        foundDir = sortedDirs.find(d => normalize(d).includes(bracketContent));
                        if (foundDir) console.log(`MATCHED via Bracket: ${foundDir}`);
                    }
                }
            }

            if (!foundDir) {
                console.log("FAILED to match.");
            }
        }

        client.release();
    } catch (err) { console.error(err); } finally { await pool.end(); }
}
verifyFix();
