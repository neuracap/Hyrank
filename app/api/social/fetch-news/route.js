import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = 'gemini-2.5-flash-lite';

// RSS feed URLs
const RSS_FEEDS = [
    { name: 'Indian Express', url: 'https://indianexpress.com/section/india/feed/' },
    { name: 'Indian Express Education', url: 'https://indianexpress.com/section/education/feed/' },
    { name: 'Google News India', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFZxYUdjU0FtVnVHZ0pKVGlnQVAB?hl=en-IN&gl=IN&ceid=IN:en' },
];

// Parse RSS XML to extract items
function parseRSS(xml, sourceName) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
        const block = match[1];
        const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/) || [])[1] || (block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
        const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
        const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
        const desc = (block.match(/<description><!\[CDATA\[(.*?)\]\]>|<description>(.*?)<\/description>/) || [])[1] || '';

        if (title.trim()) {
            items.push({
                headline: title.replace(/<[^>]*>/g, '').trim(),
                source: sourceName,
                source_url: link.trim(),
                published_at: pubDate ? new Date(pubDate).toISOString() : null,
                description: desc.replace(/<[^>]*>/g, '').trim().substring(0, 500),
            });
        }
    }
    return items;
}

/**
 * POST /api/social/fetch-news
 * Fetch news from RSS feeds, filter for exam relevance via Gemini,
 * generate MCQs, and save to current_affairs table.
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await db.connect();

    try {
        // 1. Fetch RSS feeds
        let allItems = [];
        for (const feed of RSS_FEEDS) {
            try {
                const res = await fetch(feed.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HyrankBot/1.0)' },
                });
                const xml = await res.text();
                const items = parseRSS(xml, feed.name);
                allItems.push(...items);
            } catch (e) {
                console.error(`Failed to fetch ${feed.name}:`, e.message);
            }
        }

        if (allItems.length === 0) {
            return NextResponse.json({ success: true, fetched: 0, message: 'No items from RSS feeds' });
        }

        // 2. Deduplicate against existing headlines (last 7 days)
        const existingRes = await client.query(`
            SELECT headline FROM current_affairs
            WHERE created_at > NOW() - INTERVAL '7 days'
        `);
        const existingHeadlines = new Set(existingRes.rows.map(r => r.headline.toLowerCase()));
        allItems = allItems.filter(item => !existingHeadlines.has(item.headline.toLowerCase()));

        if (allItems.length === 0) {
            return NextResponse.json({ success: true, fetched: 0, message: 'All items already fetched' });
        }

        // Limit to 30 items for Gemini processing
        const toProcess = allItems.slice(0, 30);

        // 3. Send to Gemini for filtering + MCQ generation
        const headlinesList = toProcess.map((item, i) =>
            `${i + 1}. ${item.headline}${item.description ? ' — ' + item.description.substring(0, 150) : ''}`
        ).join('\n');

        const prompt = `You are an expert on Indian competitive exams (SSC, Banking, UPSC).

From the following news headlines, identify which ones are relevant for current affairs in competitive exams.

RELEVANT topics include:
- Government schemes, policies, bills, acts
- Appointments (ministers, governors, chiefs, heads of organizations)
- Awards (Padma, national, international)
- Sports achievements (medals, tournaments, records)
- Science & technology (space, defense, inventions)
- Economy (GDP, RBI decisions, budget, trade)
- International summits, agreements, organizations
- Books, authors, cultural events
- Environment, geography events (earthquakes, cyclones named)
- Days, weeks observed (national/international)

NOT relevant: local crime, entertainment/Bollywood, stock market daily, opinions/editorials, lifestyle

For each RELEVANT headline, create:
1. A category (POLITY, ECONOMY, SCIENCE, SPORTS, AWARDS, APPOINTMENTS, INTERNATIONAL, ENVIRONMENT, MISC)
2. A brief one-line exam-relevant summary
3. An MCQ with 4 options and correct answer

Return ONLY a JSON array. For irrelevant items, skip them.
Format:
[
  {
    "index": 1,
    "category": "APPOINTMENTS",
    "exam_relevance": "One-line fact for quick revision",
    "mcq": {
      "question_en": "Who was appointed as...?",
      "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...",
      "correct": "A",
      "explanation": "Brief explanation"
    }
  }
]

Headlines:
${headlinesList}`;

        const model = genAI.getGenerativeModel({ model: MODEL });
        const result = await model.generateContent({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: 'application/json', temperature: 0.2 },
        });

        const rawText = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        let relevant;
        try {
            relevant = JSON.parse(rawText);
        } catch {
            const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            relevant = JSON.parse(cleaned);
        }

        if (!Array.isArray(relevant)) relevant = [];

        // 4. Save to DB
        let saved = 0;
        for (const item of relevant) {
            const idx = item.index - 1;
            if (idx < 0 || idx >= toProcess.length) continue;
            const source = toProcess[idx];

            try {
                await client.query(`
                    INSERT INTO current_affairs
                    (headline, summary, source, source_url, published_at, category, exam_relevance, mcq_json, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW')
                `, [
                    source.headline,
                    source.description || null,
                    source.source,
                    source.source_url || null,
                    source.published_at || null,
                    item.category || 'MISC',
                    item.exam_relevance || null,
                    item.mcq || null,
                ]);
                saved++;
            } catch (e) {
                // Skip duplicates
                if (e.code !== '23505') console.error('Save error:', e.message);
            }
        }

        return NextResponse.json({
            success: true,
            fetched: allItems.length,
            processed: toProcess.length,
            relevant: relevant.length,
            saved,
        });

    } catch (e) {
        console.error('fetch-news error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
