import { NextResponse } from 'next/server';
import { translateText } from '@/lib/translate-helpers';

const SUPPORTED = new Set(['en', 'hi']);

/**
 * POST /api/translate
 * Body: { text, source?, target? }
 *   - source defaults to 'en', target defaults to 'hi'.
 *   - Only 'en' and 'hi' are supported (provider is DeepSeek; the helper's
 *     prompt is tuned for EN↔HI exam content).
 * Returns: { translatedText }
 */
export async function POST(request) {
    try {
        const { text, source, target } = await request.json();

        if (!text || !text.trim()) {
            return NextResponse.json({ translatedText: '' });
        }

        const from = (source || 'en').toLowerCase();
        const to   = (target || 'hi').toLowerCase();

        if (!SUPPORTED.has(from) || !SUPPORTED.has(to) || from === to) {
            return NextResponse.json(
                { error: `Unsupported translation direction: ${from}→${to}` },
                { status: 400 }
            );
        }

        const translatedText = await translateText(text, { from, to });
        return NextResponse.json({ translatedText });
    } catch (e) {
        console.error('Translation error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
