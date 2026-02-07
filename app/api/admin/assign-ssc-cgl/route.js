import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

// Shared assignment logic
async function assignPapers() {
    const client = await db.connect();
    try {
        // Get all reviewers (user1 through user5)
        const reviewersQuery = await client.query(`
            SELECT id, email, name 
            FROM users 
            WHERE email IN ('user1@hyrank.com', 'user2@hyrank.com', 'user3@hyrank.com', 'user4@hyrank.com', 'user5@hyrank.com')
            ORDER BY email
        `);

        const reviewers = reviewersQuery.rows;

        if (reviewers.length === 0) {
            return NextResponse.json({ error: 'No reviewers found' }, { status: 404 });
        }

        // Get all unassigned SSC CGL papers
        const unassignedQuery = await client.query(`
            SELECT ps.paper_session_id, ps.session_label, ps.language, ps.paper_date
            FROM paper_session ps
            JOIN exam e ON ps.exam_id = e.exam_id
            LEFT JOIN review_assignments ra ON ps.paper_session_id = ra.paper_session_id
            WHERE e.name ILIKE '%SSC CGL%'  
            AND ra.paper_session_id IS NULL
            ORDER BY ps.paper_date DESC, ps.language
        `);

        const unassignedPapers = unassignedQuery.rows;

        if (unassignedPapers.length === 0) {
            return NextResponse.json({
                message: 'All SSC CGL papers are already assigned',
                assigned_count: 0
            });
        }

        // Distribute papers evenly among reviewers
        const assignments = [];
        unassignedPapers.forEach((paper, index) => {
            const reviewer = reviewers[index % reviewers.length];
            assignments.push({
                paper_session_id: paper.paper_session_id,
                reviewer_id: reviewer.id,
                reviewer_name: reviewer.name,
                paper_label: paper.session_label
            });
        });

        // Insert assignments
        await client.query('BEGIN');

        for (const assignment of assignments) {
            await client.query(`
                INSERT INTO review_assignments (paper_session_id, reviewer_id, status, assigned_at)
                VALUES ($1, $2, 'PENDING', NOW())
            `, [assignment.paper_session_id, assignment.reviewer_id]);
        }

        await client.query('COMMIT');

        // Group assignments by reviewer
        const assignmentsByReviewer = {};
        assignments.forEach(a => {
            if (!assignmentsByReviewer[a.reviewer_name]) {
                assignmentsByReviewer[a.reviewer_name] = 0;
            }
            assignmentsByReviewer[a.reviewer_name]++;
        });

        return NextResponse.json({
            success: true,
            message: `Successfully assigned ${assignments.length} SSC CGL papers`,
            total_assigned: assignments.length,
            assignments_by_reviewer: assignmentsByReviewer,
            reviewers_used: reviewers.length
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Assignment error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}

// GET handler for browser access
export async function GET(req) {
    return assignPapers();
}

// POST handler for API access
export async function POST(req) {
    return assignPapers();
}
