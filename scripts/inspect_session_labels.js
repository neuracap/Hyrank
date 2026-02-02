const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function run() {
    try {
        const res = await pool.query(`
            SELECT session_label, exam_id
            FROM paper_session
            ORDER BY paper_date DESC
            LIMIT 20;
        `);
        console.log("DB Session Labels:");
        res.rows.forEach(r => console.log(r.session_label));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
