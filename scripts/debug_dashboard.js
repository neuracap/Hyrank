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
        console.log('--- Checking paper_session table count ---');
        const count = await client.query('SELECT COUNT(*) FROM paper_session');
        console.log('Total paper_sessions:', count.rows[0].count);

        console.log('\n--- Checking JOIN query ---');
        const query = `
            SELECT 
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                e.name as exam_name
            FROM paper_session ps
            JOIN exam e ON ps.exam_id = e.exam_id
            ORDER BY ps.paper_date DESC
            LIMIT 5
        `;
        const res = await client.query(query);
        console.log('Rows returned:', res.rows.length);
        if (res.rows.length === 0) {
            console.log('JOIN returned 0 rows. Checking a few paper_sessions WITHOUT JOIN...');
            const sample = await client.query('SELECT paper_session_id, exam_id FROM paper_session LIMIT 5');
            console.log(sample.rows);

            if (sample.rows.length > 0) {
                const examId = sample.rows[0].exam_id;
                console.log(`Checking if exam exists for id: ${examId}`);
                const examCheck = await client.query('SELECT * FROM exam WHERE exam_id = $1', [examId]);
                console.log('Exam found:', examCheck.rows);
            }
        } else {
            console.log(res.rows);
        }

    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
