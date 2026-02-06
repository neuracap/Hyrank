export const dynamic = 'force-dynamic';

export default function DebugPage() {
    return (
        <div style={{ padding: '50px', fontFamily: 'system-ui' }}>
            <h1>Debug Ping</h1>
            <p><strong>Status:</strong> OK</p>
            <p><strong>Timestamp:</strong> {new Date().toISOString()}</p>
            <p><strong>Message:</strong> If you see this, the deployment pipeline is working.</p>
        </div>
    );
}
