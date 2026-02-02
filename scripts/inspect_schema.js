const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function inspect() {
    try {
        const client = await pool.connect();

        console.log('--- paper_session columns ---');
        // Get one row to see columns, or query information_schema
        const resPaper = await client.query('SELECT * FROM paper_session LIMIT 1');
        if (resPaper.rows.length > 0) {
            console.log(Object.keys(resPaper.rows[0]));
            // Check if exam_id exists
            console.log('Sample exam_id:', resPaper.rows[0].exam_id || 'NOT FOUND');
        }

        console.log('\n--- exam_section columns ---');
        const resSection = await client.query('SELECT * FROM exam_section LIMIT 1');
        if (resSection.rows.length > 0) {
            console.log(Object.keys(resSection.rows[0]));
        }

        console.log('\n--- Sections for a sample exam ---');
        if (resPaper.rows.length > 0 && resPaper.rows[0].exam_id) {
            const examId = resPaper.rows[0].exam_id;
            const sections = await client.query('SELECT * FROM exam_section WHERE exam_id = $1', [examId]);
            console.log(sections.rows);
        } else {
            console.log("Could not find an exam_id in paper_session to test with.");
        }


        client.release();
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
