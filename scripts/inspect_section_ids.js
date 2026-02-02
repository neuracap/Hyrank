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

        console.log('--- Checking exam_section_id population ---');
        const res = await client.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(exam_section_id) as has_id,
                COUNT(CASE WHEN meta_json->>'section_name' IS NOT NULL THEN 1 END) as has_name
            FROM question_version
        `);
        console.log(res.rows[0]);

        console.log('\n--- Sample rows ---');
        const resSample = await client.query(`
            SELECT question_id, exam_section_id, meta_json->>'section_name' as name
            FROM question_version
            LIMIT 5
        `);
        console.log(resSample.rows);

        client.release();
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
