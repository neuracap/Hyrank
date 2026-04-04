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

        // 3. Step 1: Send headlines to Gemini to identify relevant ones
        const headlinesList = toProcess.map((item, i) =>
            `${i + 1}. ${item.headline}${item.description ? ' — ' + item.description.substring(0, 150) : ''}`
        ).join('\n');

        const filterPrompt = `You are an expert on Indian competitive exams (SSC, Banking, UPSC).
From these news headlines, return ONLY the index numbers of items relevant for competitive exam current affairs.

RELEVANT: Government schemes, appointments, awards, sports achievements, science/tech, economy/RBI, international summits, books/authors, environment, important days.
NOT RELEVANT: Crime, entertainment, opinions, stock market daily, lifestyle, local news.

Return a JSON array of index numbers only, e.g. [1, 3, 5, 8]

Headlines:
${headlinesList}`;

        const model = genAI.getGenerativeModel({ model: MODEL });
        const filterResult = await model.generateContent({
            contents: [{ parts: [{ text: filterPrompt }] }],
            generationConfig: { response_mime_type: 'application/json', temperature: 0.1 },
        });

        let relevantIndices;
        try {
            relevantIndices = JSON.parse(filterResult.response?.candidates?.[0]?.content?.parts?.[0]?.text || '[]');
        } catch {
            relevantIndices = [];
        }

        if (!Array.isArray(relevantIndices) || relevantIndices.length === 0) {
            return NextResponse.json({ success: true, fetched: allItems.length, relevant: 0, saved: 0, message: 'No relevant items found' });
        }

        // 4. Step 2: For each relevant item, fetch article text
        const relevantItems = relevantIndices
            .map(i => ({ ...toProcess[i - 1], originalIndex: i }))
            .filter(Boolean);

        // Fetch articles in batches of 3
        for (let i = 0; i < relevantItems.length; i += 3) {
            const batch = relevantItems.slice(i, i + 3);
            await Promise.all(batch.map(async (item) => {
                item.article_text = await extractArticleText(item.source_url);
            }));
        }

        // 5. Step 3: Send relevant items WITH article text to Gemini for MCQ generation
        const detailedList = relevantItems.map((item, i) => {
            const articleSnippet = item.article_text
                ? `\nArticle: ${item.article_text.substring(0, 800)}`
                : '';
            return `${i + 1}. HEADLINE: ${item.headline}${articleSnippet}`;
        }).join('\n\n');

        const mcqPrompt = `You are an expert on Indian competitive exams (SSC, Banking, UPSC).

For each news item below, generate:
1. Category: POLITY, ECONOMY, SCIENCE, SPORTS, AWARDS, APPOINTMENTS, INTERNATIONAL, ENVIRONMENT, MISC
2. A one-line exam-relevant fact for quick revision
3. An MCQ with 4 options and correct answer, using the full article context

Return a JSON array:
[
  {
    "index": 1,
    "category": "APPOINTMENTS",
    "exam_relevance": "One-line fact",
    "mcq": {
      "question_en": "Who was appointed as...?",
      "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...",
      "correct": "A",
      "explanation": "Brief explanation with key fact from article"
    }
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

        // 6. Save to DB
        let saved = 0;
        for (const item of mcqData) {
            const idx = item.index - 1;
            if (idx < 0 || idx >= relevantItems.length) continue;
            const source = relevantItems[idx];

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
                    item.mcq || null,
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
            relevant: relevantItems.length,
            articles_extracted: relevantItems.filter(i => i.article_text).length,
            saved,
        });

    } catch (e) {
        console.error('fetch-news error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
