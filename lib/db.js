import { Pool } from 'pg';

// Use Supabase PostgreSQL connection from environment variables
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
});

// Test connection on startup
pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ PostgreSQL connection error:', err);
});

export default pool;
