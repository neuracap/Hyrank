const { Pool } = require('pg');

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

        const res = await client.query(`
            SELECT question_id, source_question_no, body_json 
            FROM question_version 
            WHERE paper_session_id = $1
            ORDER BY question_number_int ASC
        `, [sessionId]);

        console.log(`Scanning ${res.rows.length} questions...`);

        let updates = 0;

        for (const q of res.rows) {
            let text = q.body_json.text || '';
            let original = text;

            // Fix 1: Remove } before ^ or _
            // Pattern: 8}^{m} -> 8^{m}
            // Be careful not to break {a}^{b} which is valid? 
            // Usually {a}^{b} is fine.
            // But 8}^{m} is weird.
            // Let's target: digit or letter followed immediately by } then ^
            text = text.replace(/([a-zA-Z0-9])\}\^/g, '$1^');
            text = text.replace(/([a-zA-Z0-9])\}\_/g, '$1_');

            // Fix 2: Remove } before =
            // AB}= -> AB=
            text = text.replace(/\}=/g, '=');

            // Fix 3: Remove } at very end of common patterns if orphan?
            // "AD}= DC}" -> "AD= DC}" -> "AD= DC"
            // This is riskier.
            // But looking at screenshot: "AD}= DC}"
            // It seems matching pairs are missing.
            // "DC}" -> "DC"

            // Fix 4: Orphan } detection (Basic)
            // Count { and }. If } > {, remove extra?
            // Too complex for regex.

            if (text !== original) {
                console.log(`\n[Q.${q.source_question_no}] Fix proposed:`);
                console.log(`ORIG: ${original.substring(0, 100)}...`);
                console.log(`NEW : ${text.substring(0, 100)}...`);
                updates++;

                // UNCOMMENT TO APPLY
                await client.query(`
                    UPDATE question_version 
                    SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text))
                    WHERE question_id = $2
                 `, [text, q.question_id]);
            }
        }

        console.log(`\nTotal questions to fix: ${updates}`);

    } finally {
        client.release();
        pool.end();
    }
}

run();
