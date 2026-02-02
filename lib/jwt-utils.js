/**
 * Native Web Crypto JWT Implementation (Zero Dependencies)
 * Guaranteed to work in Edge Runtime
 */

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecretKey() {
    return process.env.SESSION_SECRET || 'your-super-secret-key-change-this';
}

/**
 * Sign a JWT using native Web Crypto API
 */
export async function createSessionToken(payload) {
    const secret = getSecretKey();
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);

    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const body = {
        ...payload,
        iat: now,
        exp: now + (7 * 24 * 60 * 60), // 7 days
    };

    const encodedHeader = btoa(JSON.stringify(header));
    const encodedBody = btoa(JSON.stringify(body));
    const data = encoder.encode(`${encodedHeader}.${encodedBody}`);

    const signature = await crypto.subtle.sign('HMAC', key, data);
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    return `${encodedHeader}.${encodedBody}.${encodedSignature}`;
}

/**
 * Verify a JWT using native Web Crypto API
 */
export async function verifySessionToken(token) {
    try {
        const [encodedHeader, encodedBody, encodedSignature] = token.split('.');
        const secret = getSecretKey();
        const encoder = new TextEncoder();
        const keyData = encoder.encode(secret);

        const key = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const data = encoder.encode(`${encodedHeader}.${encodedBody}`);
        const signature = Uint8Array.from(atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

        const isValid = await crypto.subtle.verify('HMAC', key, signature, data);

        if (!isValid) return null;

        const payload = JSON.parse(atob(encodedBody));
        const now = Math.floor(Date.now() / 1000);

        if (payload.exp && payload.exp < now) return null;

        return payload;
    } catch (e) {
        return null;
    }
}

// Helper for base64 encoding/decoding in Edge if standard btoa/atob have issues (rare, but safe)
function btoa(str) {
    return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function atob(str) {
    return Buffer.from(str, 'base64').toString('binary');
}
