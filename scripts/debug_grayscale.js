const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function run() {
    const client = await pool.connect();
    try {
        const sessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';

        // Find a question with images
        const res = await client.query(`
            SELECT question_id, body_json 
            FROM question_version 
            WHERE paper_session_id = $1 
            AND body_json->>'text' LIKE '%/images/%'
            LIMIT 1
        `, [sessionId]);

        if (res.rows.length === 0) {
            console.log("No questions with images found in this session.");
            return;
        }

        const q = res.rows[0];
        console.log(`Found Question: ${q.question_id}`);
        const text = q.body_json.text;
        console.log("Text Snippet:", text.substring(0, 100));

        // Regex logic
        const imgRegex = /(!\[.*?\]\(.*?\))|(\\includegraphics\{.*?\})/g;
        const matches = text.match(imgRegex);
        console.log("Matches:", matches);

        if (!matches) return;

        // Test Resolution
        for (const m of matches) {
            console.log(`\nProcessing Match: "${m}"`);

            let filename = null;
            if (m.includes('/images/')) {
                // Mimic the route.js logic EXACTLY
                filename = m.split('/images/').pop().split(')')[0];
            }
            console.log(`Extracted Filename: "${filename}"`);

            if (filename) {
                const fileRes = await client.query(`
                    SELECT local_path FROM asset 
                    WHERE local_path LIKE '%' || $1 || '%' OR original_name = $1
                    LIMIT 1
                `, [filename]);

                console.log(`DB Lookup Rows: ${fileRes.rows.length}`);
                if (fileRes.rows.length > 0) {
                    const localPath = fileRes.rows[0].local_path;
                    console.log(`Resolved Path: ${localPath}`);
                    console.log(`Exists on Disk: ${fs.existsSync(localPath)}`);
                } else {
                    console.log("FAILED to find in DB");
                }
            }
        }

    } finally {
        client.release();
        pool.end();
    }
}

run();
