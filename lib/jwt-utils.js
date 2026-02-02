/**
 * Native Web Crypto JWT Implementation (Zero Dependencies)
 * Guaranteed to work in Edge Runtime (No Node.js Buffer!)
 */

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

    // Use standard btoa implementation
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedBody = base64UrlEncode(JSON.stringify(body));
    const data = encoder.encode(`${encodedHeader}.${encodedBody}`);

    const signature = await crypto.subtle.sign('HMAC', key, data);
    // Convert ArrayBuffer to string properly
    const signatureArray = Array.from(new Uint8Array(signature));
    const signatureString = signatureArray.map(b => String.fromCharCode(b)).join('');
    const encodedSignature = base64UrlEncode(signatureString, true); // true = raw string input

    return `${encodedHeader}.${encodedBody}.${encodedSignature}`;
}

/**
 * Verify a JWT using native Web Crypto API
 */
export async function verifySessionToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [encodedHeader, encodedBody, encodedSignature] = parts;

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

        // Correctly decode signature from Base64Url
        const signatureBin = base64UrlDecode(encodedSignature);
        const signature = new Uint8Array(signatureBin.length);
        for (let i = 0; i < signatureBin.length; i++) {
            signature[i] = signatureBin.charCodeAt(i);
        }

        const isValid = await crypto.subtle.verify('HMAC', key, signature, data);

        if (!isValid) return null;

        const payload = JSON.parse(base64UrlDecode(encodedBody));
        const now = Math.floor(Date.now() / 1000);

        if (payload.exp && payload.exp < now) return null;

        return payload;
    } catch (e) {
        console.error('JWT Verify Error:', e);
        return null;
    }
}

// Edge-safe Base64Url Helpers (No Buffer!)
function base64UrlEncode(str, isRaw = false) {
    // If input is not raw binary string, assume UTF-8 and encode
    const input = isRaw ? str : unescape(encodeURIComponent(str));
    return btoa(input)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    const decoded = atob(str);
    try {
        // Try decoding as UTF-8
        return decodeURIComponent(escape(decoded));
    } catch (e) {
        // Return raw binary string if UTF-8 decode fails (e.g. for signature)
        return decoded;
    }
}
