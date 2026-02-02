/**
 * Simple test to check connection string parsing
 */

// Test different connection string formats
const testStrings = [
    // Format 1: Standard with encoded password
    'postgresql://postgres.plsgmceffqgvramclryu:Chhenagad395mal%40@db.plsgmceffqgvramclryu.supabase.co:6543/postgres',

    // Format 2: With double-encoded @
    'postgresql://postgres.plsgmceffqgvramclryu:Chhenagad395mal%2540@db.plsgmceffqgvramclryu.supabase.co:6543/postgres',

    // Format 3: Plain text (might work if pg handles it)
    'postgresql://postgres.plsgmceffqgvramclryu:Chhenagad395mal@@db.plsgmceffqgvramclryu.supabase.co:6543/postgres',
];

console.log('Testing connection string formats:\n');

testStrings.forEach((str, i) => {
    console.log(`Format ${i + 1}:`);
    console.log(str.replace(/:([^:]+)@db/, ':****@db'));
    console.log('');
});

// Let's also try direct connection with explicit params
const { Pool } = require('pg');

async function testDirect() {
    console.log('\n=== Testing Direct Connection ===\n');

    const pool = new Pool({
        user: 'postgres.plsgmceffqgvramclryu',
        password: 'Chhenagad395mal@',
        host: 'db.plsgmceffqgvramclryu.supabase.co',
        port: 6543,
        database: 'postgres',
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Direct connection successful!');
        console.log('Time:', result.rows[0].now);
    } catch (error) {
        console.error('❌ Direct connection failed:', error.message);
    } finally {
        await pool.end();
    }
}

testDirect();
