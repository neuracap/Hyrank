const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkSections() {
    try {
        const client = await pool.connect();

        const sessionRes = await client.query(`
        SELECT ps.exam_id FROM paper_session ps ORDER BY ps.created_at DESC LIMIT 1
    `);
        const exam_id = sessionRes.rows[0].exam_id;

        const sectionsRes = await client.query(`
        SELECT code, name FROM exam_section WHERE exam_id = $1
    `, [exam_id]);

        console.log(sectionsRes.rows.map(s => `${s.code}: ${s.name}`));
        client.release();
    } catch (err) { console.error(err); } finally { await pool.end(); }
}
checkSections();
