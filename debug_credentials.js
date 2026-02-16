require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const password = 'Chhenagad395mal#$'; // Plain text from .env.local

const configs = [
    {
        name: 'Direct URL - User: postgres',
        connectionString: `postgresql://postgres:${encodeURIComponent(password)}@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`
    },
    {
        name: 'Direct URL - User: postgres.plsgmceffqgvramclryu',
        connectionString: `postgresql://postgres.plsgmceffqgvramclryu:${encodeURIComponent(password)}@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`
    },
    {
        name: 'Pooler URL - User: postgres.plsgmceffqgvramclryu',
        connectionString: `postgresql://postgres.plsgmceffqgvramclryu:${encodeURIComponent(password)}@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true`
    }
];

async function testConfig(config) {
    console.log(`\nTesting: ${config.name}`);
    const pool = new Pool({
        connectionString: config.connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000
    });

    try {
        const client = await pool.connect();
        console.log('✅ Connected successfully!');
        const res = await client.query('SELECT current_user');
        console.log('User:', res.rows[0].current_user);
        client.release();
    } catch (e) {
        console.log('❌ Failed:', e.message);
        if (e.code) console.log('   Code:', e.code);
    } finally {
        await pool.end();
    }
}

async function run() {
    for (const config of configs) {
        await testConfig(config);
    }
}

run();
