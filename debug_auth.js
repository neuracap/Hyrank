const { Pool } = require('pg');

const config = {
    user: 'postgres.plsgmceffqgvramclryu',
    host: 'aws-1-ap-northeast-1.pooler.supabase.com',
    database: 'postgres',
    password: 'Chhenagad395mal#$', // Plain text password
    port: 5432,
    ssl: { rejectUnauthorized: false }
};

console.log('Testing connection with config:', { ...config, password: '***' });

const pool = new Pool(config);

async function test() {
    try {
        const client = await pool.connect();
        console.log('Connected successfully!');
        const res = await client.query('SELECT NOW()');
        console.log('Time:', res.rows[0]);
        client.release();
    } catch (e) {
        console.error('Connection failed:', e);
    } finally {
        await pool.end();
    }
}

test();
