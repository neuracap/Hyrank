import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = 'gemini-2.5-flash-lite';

const RSS_FEEDS = [
    { name: 'Indian Express India', url: 'https://indianexpress.com/section/india/feed/' },
    { name: 'Indian Express Education', url: 'https://indianexpress.com/section/education/feed/' },
    { name: 'Indian Express Economy', url: 'https://indianexpress.com/section/business/economy/feed/' },
    { name: 'Indian Express Sports', url: 'https://indianexpress.com/section/sports/feed/' },
    { name: 'The Hindu National', url: 'https://www.thehindu.com/news/national/feeder/default.rss' },
    { name: 'The Hindu Science', url: 'https://www.thehindu.com/sci-tech/science/feeder/default.rss' },
    { name: 'Google News India', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFZxYUdjU0FtVnVHZ0pKVGlnQVAB?hl=en-IN&gl=IN&ceid=IN:en' },
];

function parseRSS(xml, sourceName) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
        const block = match[1];
        const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]>/) || [])[1]
            || (block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
        const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
        const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
        const desc = (block.match(/<description><!\[CDATA\[(.*?)\]\]>/) || [])[1]
            || (block.match(/<description>(.*?)<\/description>/) || [])[1] || '';

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

// Extract article body text from a URL
async function extractArticleText(url) {
    if (!url) return null;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return null;
        const html = await res.text();

        // Try common article content selectors via regex
        // Indian Express uses <div class="full-details"> or article-body
        // The Hindu uses <div class="article">
        let articleHtml = '';

        // Strategy 1: Look for article body divs
        const patterns = [
            /<div[^>]*class="[^"]*(?:full-details|article-body|story-detail|article__content|article-content|entry-content|post-content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<\/article|<footer|<aside)/i,
            /<article[^>]*>([\s\S]*?)<\/article>/i,
        ];

        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1] && match[1].length > 200) {
                articleHtml = match[1];
                break;
            }
        }

        // Strategy 2: Look for <p> tags within a large content block
        if (!articleHtml) {
            const pTags = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
            const longPs = pTags
                .map(p => p.replace(/<[^>]*>/g, '').trim())
                .filter(t => t.length > 50);
            if (longPs.length >= 3) {
                articleHtml = longPs.join('\n\n');
            }
        }

        if (!articleHtml) return null;

        // Strip HTML tags, clean up
        const text = articleHtml
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();

        return text.length > 100 ? text.substring(0, 3000) : null;
    } catch {
        return null;
    }
}

export async function POST(req) {
    // Allow cron calls via API key OR admin session
    const cronKey = req.headers.get('x-cron-key');
    const envSecret = process.env.CRON_SECRET;
    const isValidCron = cronKey && envSecret && cronKey === envSecret;

    if (!isValidCron) {
        // If cron key was provided but didn't match, log it
        if (cronKey) {
            console.log('Cron key mismatch. Received:', cronKey?.substring(0, 10) + '...', 'Env set:', !!envSecret);
        }
        const user = await getCurrentUser();
        if (!user?.isAdmin) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    const client = await db.connect();

    try {
        // 1. Fetch RSS feeds
        let allItems = [];
        for (const feed of RSS_FEEDS) {
            try {
                const res = await fetch(feed.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HyrankBot/1.0)' },
                    signal: AbortSignal.timeout(10000),
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

        // 2. Deduplicate
        const existingRes = await client.query(
            `SELECT headline FROM current_affairs WHERE created_at > NOW() - INTERVAL '7 days'`
        );
        const existingHeadlines = new Set(existingRes.rows.map(r => r.headline.toLowerCase()));
        allItems = allItems.filter(item => !existingHeadlines.has(item.headline.toLowerCase()));

        if (allItems.length === 0) {
            return NextResponse.json({ success: true, fetched: 0, message: 'All items already fetched' });
        }

        const toProcess = allItems.slice(0, 30);

        // 3. Fetch article text for all items (in parallel batches of 5)
        for (let i = 0; i < toProcess.length; i += 5) {
            const batch = toProcess.slice(i, i + 5);
            await Promise.all(batch.map(async (item) => {
                item.article_text = await extractArticleText(item.source_url);
            }));
        }

        // 4. Send all items to Gemini — filter + categorize + generate MCQs in one call
        const detailedList = toProcess.map((item, i) => {
            const articleSnippet = item.article_text
                ? `\nArticle: ${item.article_text.substring(0, 800)}`
                : '';
            return `${i + 1}. HEADLINE: ${item.headline}${item.description ? ' — ' + item.description.substring(0, 150) : ''}${articleSnippet}`;
        }).join('\n\n');

        const model = genAI.getGenerativeModel({ model: MODEL });
        const mcqPrompt = `You are an expert curator for Indian competitive exam current affairs (UPSC/SSC/Banking/Railways/State PSC).

Your job: Given raw news items, decide if each deserves a question in an exam conducted 6–18 months from now.

MENTAL MODEL — The "One-Pager Test":
Imagine a well-read IAS officer preparing a one-page briefing note on this topic, a year from now.
Would this news item be cited as a key data point, milestone, or turning point?
If YES → WORTHY. If NO → SKIP.

━━━ WORTHY TRIGGERS (pass if ANY one applies) ━━━
1. FIRST / RECORD — India's first X, world's first Y, new record
2. POLICY / LAW / SCHEME — Act passed/amended, scheme launched, RBI/SEBI regulation, court ruling with precedent
3. APPOINTMENT — CJI, CEC, CAG, RBI Governor, Army Chief, UN agency heads, BRICS/SCO/G20 chairs
4. TREATY / AGREEMENT — Bilateral/multilateral trade, defence, climate, tech MoUs
5. RANKING / INDEX / REPORT — HDI, Press Freedom, Global Hunger, WHO/WEF/IPCC/RBI reports
6. INTERNATIONAL ORG ACTION — IMF/WTO/WHO decision, new member to SCO/BRICS, India elected to a body
7. GEOGRAPHY IN NEWS — Conflict, summit, disaster, new district, strategic corridor
8. SCIENCE / SPACE / TECH — ISRO/NASA launch, new species, disease outbreak, AI/quantum breakthrough
9. SPORTS MILESTONE — World championship, India's first medal, Olympic host, Arjuna/Khel Ratna awards
10. OBITUARY — Serving/former PM/President/CJI, Nobel laureate, legendary sportsperson
11. ECONOMIC DATA — GDP, RBI rate decision, inflation, fiscal deficit, Budget key allocations
12. AWARDS — Padma awards, Nobel, Booker, Bharat Ratna, Gallantry awards, Sahitya Akademi
13. ENVIRONMENT — New Ramsar/UNESCO site, IUCN update, COP decision, new national park
14. DEFENCE — New missile/weapon tested, military exercise, warship commissioned
15. ECONOMIC CONCEPT IN NEWS — Stagflation, CBDC, yield curve, new price index
16. STATIC GK HOOK — News unlocks high-frequency concept (Art 371, AFSPA, GST Art 279A, etc.)

━━━ SKIP ━━━
- Political statements, rallies, party feuds, opinion polls
- Minor admin reshuffles, crime/accident without policy angle
- Corporate earnings, rebranding, celebrity news
- Repetitive updates on already-captured stories
- Regional events with no national significance
- Sports match results (not milestones)

━━━ BORDERLINE RULE ━━━
"Would Vajiram/Vision IAS include this in their monthly magazine?" If yes → WORTHY.

━━━ OUTPUT ━━━
For each WORTHY item, generate 1 or 2 MCQs. Skip unworthy items entirely.

Category: POLITY, ECONOMY, SCIENCE, SPORTS, AWARDS, APPOINTMENTS, INTERNATIONAL, ENVIRONMENT, DEFENCE, MISC

Return a JSON array:
[
  {
    "index": 1,
    "category": "APPOINTMENTS",
    "exam_relevance": "One-line exam fact for quick revision",
    "mcqs": [
      {
        "question_en": "Who was appointed as the new Chief Justice of India in April 2026?",
        "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...",
        "correct": "A",
        "explanation": "Key fact + constitutional provision (Art 124)"
      }
    ]
  }
]

News Items:
${detailedList}`;

        const mcqResult = await model.generateContent({
            contents: [{ parts: [{ text: mcqPrompt }] }],
            generationConfig: { response_mime_type: 'application/json', temperature: 0.2 },
        });

        let mcqData;
        try {
            mcqData = JSON.parse(mcqResult.response?.candidates?.[0]?.content?.parts?.[0]?.text || '[]');
        } catch {
            mcqData = [];
        }
        if (!Array.isArray(mcqData)) mcqData = [];

        // 5. Save to DB — each news item may have 1-2 MCQs stored as array
        let saved = 0;
        for (const item of mcqData) {
            const idx = item.index - 1;
            if (idx < 0 || idx >= toProcess.length) continue;
            const source = toProcess[idx];

            // Support both old format (item.mcq) and new format (item.mcqs array)
            const mcqs = item.mcqs || (item.mcq ? [item.mcq] : []);

            try {
                await client.query(`
                    INSERT INTO current_affairs
                    (headline, summary, source, source_url, published_at, category,
                     exam_relevance, mcq_json, article_text, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'NEW')
                `, [
                    source.headline,
                    source.description || null,
                    source.source,
                    source.source_url || null,
                    source.published_at || null,
                    item.category || 'MISC',
                    item.exam_relevance || null,
                    mcqs, // Store as array of MCQs
                    source.article_text || null,
                ]);
                saved++;
            } catch (e) {
                if (e.code !== '23505') console.error('Save error:', e.message);
            }
        }

        return NextResponse.json({
            success: true,
            fetched: allItems.length,
            processed: toProcess.length,
            relevant: mcqData.length,
            articles_extracted: toProcess.filter(i => i.article_text).length,
            saved,
        });

    } catch (e) {
        console.error('fetch-news error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
