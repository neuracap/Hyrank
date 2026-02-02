const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function getPairID() {
    const sessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    try {
        const client = await pool.connect();
        const targetRes = await client.query('SELECT created_at, exam_id FROM paper_session WHERE paper_session_id = $1', [sessionId]);
        const target = targetRes.rows[0];

        const res = await client.query(`
        SELECT paper_session_id
        FROM paper_session
        WHERE exam_id = $1 
          AND paper_session_id != $2
          AND created_at BETWEEN $3::timestamp - interval '5 minutes' AND $3::timestamp + interval '5 minutes'
        LIMIT 1
    `, [target.exam_id, sessionId, target.created_at]);

        if (res.rows.length > 0) {
            const id = res.rows[0].paper_session_id;
            console.log(`FULL_ID: ${id}`);
            for (let i = 18; i < 25; i++) {
                console.log(`Char[${i}] = ${id[i]} (${id.charCodeAt(i)})`);
            }
        } else {
            console.log("NO_PAIR_FOUND");
        }

        client.release();
    } catch (e) { console.error(e); } finally { await pool.end(); }
}
getPairID();
