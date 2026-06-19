import { Pool } from 'pg';

// Prefer the DIRECT connection (port 5432) over Supabase's pooler
// (port 6543, PgBouncer in transaction mode). Reason: PgBouncer in
// transaction mode is a bad fit for Next.js SSR routes that hold a
// persistent connection pool — its 15s checkout timeout fires under
// any sustained load (we saw ECHECKOUTTIMEOUT on /dashboard once a
// few connections got stuck). Each Railway instance can safely keep
// its own small persistent pool against the direct port.
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 60000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
});

pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ PostgreSQL connection error:', err);
});

export default pool;
