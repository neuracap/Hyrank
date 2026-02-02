export default function Home() {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            fontFamily: 'system-ui, sans-serif',
            padding: '20px',
            textAlign: 'center'
        }}>
            <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</h1>
            <h2>Deployment Successful!</h2>
            <p style={{ color: '#666', marginTop: '1rem' }}>
                The site is now working on Vercel.
            </p>
            <p style={{ color: '#666', fontSize: '0.9rem', marginTop: '2rem' }}>
                Database connection and authentication are being configured...
            </p>
        </div>
    );
}
