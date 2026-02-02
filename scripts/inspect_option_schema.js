const pool = require('../lib/db').default;

async function inspect() {
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'question_option';
        `);
        console.log('--- question_option columns ---');
        console.log(res.rows.map(r => r.column_name).join(', '));
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
    }
}

inspect();
