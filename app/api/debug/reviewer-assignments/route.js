import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    const client = await db.connect();
    try {
        // Get all SSC CGL papers with their reviewer assignments
        const query = `
            SELECT 
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.language,
                e.name as exam_name,
                u.name as reviewer_name,
                u.email as reviewer_email,
                ra.status as assignment_status,
                ra.assigned_at
            FROM paper_session ps
            JOIN exam e ON ps.exam_id = e.exam_id
            LEFT JOIN review_assignments ra ON ps.paper_session_id = ra.paper_session_id
            LEFT JOIN users u ON ra.reviewer_id = u.id
            WHERE e.name ILIKE '%SSC CGL%'
            ORDER BY ps.paper_date DESC, ps.language, u.name
        `;

        const result = await client.query(query);

        // Group by paper and show assignments
        const papers = {};
        result.rows.forEach(row => {
            const key = row.paper_session_id;
            if (!papers[key]) {
                papers[key] = {
                    paper_session_id: row.paper_session_id,
                    session_label: row.session_label,
                    paper_date: row.paper_date,
                    language: row.language,
                    exam_name: row.exam_name,
                    reviewers: []
                };
            }
            if (row.reviewer_name) {
                papers[key].reviewers.push({
                    name: row.reviewer_name,
                    email: row.reviewer_email,
                    status: row.assignment_status,
                    assigned_at: row.assigned_at
                });
            }
        });

        const paperList = Object.values(papers);
        const unassigned = paperList.filter(p => p.reviewers.length === 0);
        const assigned = paperList.filter(p => p.reviewers.length > 0);

        return NextResponse.json({
            total_ssc_cgl_papers: paperList.length,
            assigned_count: assigned.length,
            unassigned_count: unassigned.length,
            papers: paperList,
            unassigned_papers: unassigned
        });

    } catch (error) {
        console.error('Query error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
