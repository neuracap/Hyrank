/**
 * Test database connection to Supabase
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function testConnection() {
    console.log('Testing Supabase PostgreSQL connection...\n');
    console.log('Connection string format:', process.env.DATABASE_URL ? 'Found' : 'Not found');

    // Mask password in log
    const maskedUrl = process.env.DATABASE_URL?.replace(/:([^@]+)@/, ':****@');
    console.log('Connection URL:', maskedUrl);
    console.log('');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        // Test simple query
        const result = await pool.query('SELECT NOW() as current_time, version()');
        console.log('✅ Connection successful!');
        console.log('Server time:', result.rows[0].current_time);
        console.log('PostgreSQL version:', result.rows[0].version.substring(0, 50) + '...');
        console.log('');

        // Check existing tables
        const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

        console.log('Existing tables:', tables.rows.length);
        tables.rows.forEach(row => console.log('  -', row.table_name));

    } catch (error) {
        console.error('❌ Connection failed!');
        console.error('Error:', error.message);
        console.error('');
        console.error('Common issues:');
        console.error('1. Check if password has special characters that need URL encoding');
        console.error('2. Verify the database URL is correct');
        console.error('3. Ensure Supabase project is active');
    } finally {
        await pool.end();
    }
}

testConnection();
