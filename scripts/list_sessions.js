const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function findSessions() {
    const sessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    try {
        const client = await pool.connect();

        // Get exam ID first
        const res = await client.query('SELECT exam_id FROM paper_session WHERE paper_session_id = $1', [sessionId]);
        const examId = res.rows[0].exam_id;

        // Get all sessions for this exam
        const sessions = await client.query(`
        SELECT paper_session_id, session_label, created_at 
        FROM paper_session 
        WHERE exam_id = $1
        ORDER BY created_at DESC
        LIMIT 20
    `, [examId]);

        console.log(`Found ${sessions.rows.length} sessions for exam ${examId}:`);
        sessions.rows.forEach(s => {
            console.log(`[${s.paper_session_id}] ${s.session_label}`);
        });

        client.release();
    } catch (e) { console.error(e); } finally { await pool.end(); }
}
findSessions();
