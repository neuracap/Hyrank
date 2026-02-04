const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

const client = new Client({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
    await client.connect();
    try {
        const res = await client.query(`
            SELECT column_name, data_type, udt_name, character_maximum_length
            FROM information_schema.columns 
            WHERE table_name = 'question_links' AND column_name = 'status';
        `);
        console.log("Status Column:", res.rows[0]);
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}

checkSchema();
