require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

// Create a new pool using the environment variable manually to ensure no interference from lib/db
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000, // 5 second timeout
});

async function testConnection() {
    console.log('Testing connection to DATABASE_URL...');
    console.log('URL:', process.env.DATABASE_URL?.split('@')[1]); // Log host part of URL for verification

    try {
        const client = await pool.connect();
        console.log('Successfully acquired client');
        const res = await client.query('SELECT NOW()');
        console.log('Result:', res.rows[0]);
        client.release();
    } catch (err) {
        console.error('Connection failed (DATABASE_URL):', err);
    }

    // Try DIRECT_URL if available
    if (process.env.DIRECT_URL) {
        console.log('\nTesting connection to DIRECT_URL...');
        console.log('URL:', process.env.DIRECT_URL?.split('@')[1]);
        const directPool = new Pool({
            connectionString: process.env.DIRECT_URL,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 5000,
        });

        try {
            const client = await directPool.connect();
            console.log('Successfully acquired client (DIRECT)');
            const res = await client.query('SELECT NOW()');
            console.log('Result:', res.rows[0]);
            client.release();
            await directPool.end();
        } catch (err) {
            console.error('Connection failed (DIRECT_URL):', err);
        }
    }

    await pool.end();
}

testConnection();
