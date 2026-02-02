const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function findPair() {
    const sessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    try {
        const client = await pool.connect();

        // Get target session info
        const targetRes = await client.query('SELECT created_at, exam_id, session_label FROM paper_session WHERE paper_session_id = $1', [sessionId]);
        const target = targetRes.rows[0];

        console.log(`Target: [${sessionId}] ${target.session_label}`);
        console.log(`Time: ${target.created_at}`);

        // Find sessions within +/- 5 minutes
        const res = await client.query(`
        SELECT paper_session_id, session_label, created_at
        FROM paper_session
        WHERE exam_id = $1 
          AND paper_session_id != $2
          AND created_at BETWEEN $3::timestamp - interval '5 minutes' AND $3::timestamp + interval '5 minutes'
    `, [target.exam_id, sessionId, target.created_at]);

        console.log(`\nFound ${res.rows.length} potential pairs:`);
        res.rows.forEach(r => {
            console.log(`[${r.paper_session_id}] ${r.session_label}`);
        });

        client.release();
    } catch (e) { console.error(e); } finally { await pool.end(); }
}
findPair();
