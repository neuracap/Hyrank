import { Pool } from 'pg';

// IMPORTANT: must use DATABASE_URL (Supabase pooler on port 6543).
// Supabase's DIRECT_URL (port 5432) is IPv6-only and Railway runtime
// has no outbound IPv6 — every connection attempt against the direct
// URL fails immediately and 500s every API route (including /auth/login).
//
// To survive PgBouncer transaction mode in a long-lived SSR pool:
//   - keep `max` small so we don't blow Supabase's pooler quota
//   - tighten idle timeout so stuck connections are reaped fast
//   - tighten connect timeout so the UI gets a real error instead of
//     hanging at the 15s pooler-checkout ceiling
//   - allowExitOnIdle so dev hot-reload doesn't leak sockets
const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    allowExitOnIdle: false,
});

pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ PostgreSQL connection error:', err);
});

export default pool;
