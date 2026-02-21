
const db = require('../lib/db').default || require('../lib/db');

async function checkStatus() {
    const client = await db.connect();
    try {
        const res = await client.query(`
            SELECT status, COUNT(*) 
            FROM question_links 
            GROUP BY status
        `);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
    }
}

checkStatus();
