const { Pool } = require('pg');
const fs = require('fs');

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
        const res = await client.query('SELECT * FROM question_version LIMIT 1');

        let output = {};

        if (res.rows.length > 0) {
            const q = res.rows[0];
            output.question = {
                id: q.question_id,
                version: q.version_no,
                body_json: q.body_json,
                solution_json: q.solution_json,
                meta_json: q.meta_json
            };

            const opts = await client.query('SELECT * FROM question_option WHERE question_id = $1', [q.question_id]);
            output.options = opts.rows;
        }

        fs.writeFileSync('inspect_result.json', JSON.stringify(output, null, 2));
        console.log('Written to inspect_result.json');

        client.release();
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
