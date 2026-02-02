import db from '@/lib/db';
import DashboardTable from '@/components/DashboardTable';

export const dynamic = 'force-dynamic';

async function fetchDashboardData() {
    const client = await db.connect();
    try {
        // Fetch all paper sessions with exam details
        // We also want to aggregate languages and count questions

        // 1. Get Sessions
        const sessionsRes = await client.query(`
            SELECT 
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.meta_json,
                e.name as exam_name
            FROM paper_session ps
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            ORDER BY ps.paper_date DESC
        `);

        const sessions = sessionsRes.rows;

        // 2. Enhance with counts and languages (could be optimized with a complex JOIN/GROUP BY, 
        // but simple separate queries are safer given potentially complex json text storage)

        const countsRes = await client.query(`
            SELECT 
                paper_session_id, 
                COUNT(*) as q_count,
                array_agg(DISTINCT language) as langs
            FROM question_version
            GROUP BY paper_session_id
        `);

        const countsMap = {};
        countsRes.rows.forEach(row => {
            countsMap[row.paper_session_id] = {
                count: row.q_count,
                langs: row.langs.filter(l => l) // remove nulls
            };
        });

        return sessions.map(s => {
            const stats = countsMap[s.paper_session_id] || { count: 0, langs: [] };
            const meta = s.meta_json || {};

            return {
                id: s.paper_session_id,
                exam_name: s.exam_name || 'Unknown Exam',
                paper_date: s.paper_date ? new Date(s.paper_date).toISOString() : null,
                session_label: s.session_label,
                question_count: parseInt(stats.count, 10),
                languages: stats.langs.join(', '),
                questions_checked: meta.questions_checked || false,
                answers_checked: meta.answers_checked || false,
                pdf_link: meta.pdf_link || null
            };
        });

    } catch (e) {
        console.error("Error fetching dashboard data:", e);
        // Fallback to empty array but log error
        return [];
    } finally {
        if (client) client.release();
    }
}

export default async function DashboardPage() {
    const sessions = await fetchDashboardData();

    return (
        <div className="min-h-screen bg-gray-100 p-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Exam Review Dashboard</h1>
                    <div className="text-sm text-gray-500">
                        Total papers: {sessions.length}
                    </div>
                </div>

                <DashboardTable sessions={sessions} />
            </div>
        </div>
    );
}
