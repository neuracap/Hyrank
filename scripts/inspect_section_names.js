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

        console.log('--- Sample Section Names ---');
        const res = await client.query(`
            SELECT meta_json->>'section_name' as sec, count(*) 
            FROM question_version 
            GROUP BY sec 
            ORDER BY count(*) DESC 
            LIMIT 10
        `);
        console.log(res.rows);

        client.release();
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
