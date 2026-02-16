require('dotenv').config({ path: '.env.local' });
// Import db AFTER loading env vars
const pool = require('./lib/db').default;

async function testConnection() {
    console.log('Testing connection to:', process.env.DATABASE_URL ? 'Supabase URL Provided' : 'Missing URL');
    try {
        const client = await pool.connect();
        console.log('Successfully acquired client');
        const res = await client.query('SELECT NOW()');
        console.log('Result:', res.rows[0]);
        client.release();
    } catch (err) {
        console.error('Connection failed:', err);
    } finally {
        await pool.end();
    }
}

testConnection();
