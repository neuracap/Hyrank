'use client';

export default function Home() {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            fontFamily: 'system-ui, sans-serif',
            padding: '20px'
        }}>
            <h1>🎉 Deployment Successful!</h1>
            <p>The site is now working on Vercel.</p>
            <p style={{ marginTop: '20px', color: '#666' }}>
                Database connection and authentication are being configured...
            </p>
        </div>
    );
}
