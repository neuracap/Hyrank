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
        const res = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'question_version'
        `);
        console.log(JSON.stringify(res.rows.map(r => r.column_name), null, 2));
        client.release();
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
