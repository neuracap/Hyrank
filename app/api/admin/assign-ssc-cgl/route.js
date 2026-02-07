import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

// Shared assignment logic - assigns bilingual PAIRS to the same reviewer
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

        // STEP 1: Clear all existing SSC CGL assignments
        await client.query('BEGIN');

        const deleteResult = await client.query(`
            DELETE FROM review_assignments 
            WHERE paper_session_id IN (
                SELECT ps.paper_session_id 
                FROM paper_session ps
                JOIN exam e ON ps.exam_id = e.exam_id
                WHERE e.name ILIKE '%SSC CGL%'
            )
        `);

        console.log(`Cleared ${deleteResult.rowCount} existing SSC CGL assignments`);

        // STEP 2: Get bilingual paper PAIRS (EN + HI from same exam/date/shift)
        const pairsQuery = await client.query(`
            SELECT 
                e.name AS exam_name,
                s1.paper_date,
                s1.shift_number,
                s1.paper_session_id AS english_session_id,
                s1.session_label AS english_label,
                s2.paper_session_id AS hindi_session_id,
                s2.session_label AS hindi_label
            FROM paper_session s1
            JOIN paper_session s2 
                ON s1.exam_id = s2.exam_id 
                AND s1.paper_date = s2.paper_date 
                AND s1.shift_number = s2.shift_number
            JOIN exam e ON s1.exam_id = e.exam_id
            WHERE s1.language = 'EN' 
            AND s2.language = 'HI'
            AND e.name ILIKE '%SSC CGL%'
            ORDER BY s1.paper_date DESC, s1.shift_number ASC
        `);

        const pairs = pairsQuery.rows;

        if (pairs.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({
                message: 'No bilingual SSC CGL paper pairs found',
                assigned_count: 0
            });
        }

        // STEP 3: Assign each PAIR to the same reviewer (round-robin)
        const assignments = [];
        pairs.forEach((pair, index) => {
            const reviewer = reviewers[index % reviewers.length];

            // Assign BOTH English and Hindi papers to the SAME reviewer
            assignments.push({
                paper_session_id: pair.english_session_id,
                reviewer_id: reviewer.id,
                reviewer_name: reviewer.name,
                language: 'EN',
                pair_index: index + 1
            });

            assignments.push({
                paper_session_id: pair.hindi_session_id,
                reviewer_id: reviewer.id,
                reviewer_name: reviewer.name,
                language: 'HI',
                pair_index: index + 1
            });
        });

        // STEP 4: Insert all assignments
        for (const assignment of assignments) {
            await client.query(`
                INSERT INTO review_assignments (paper_session_id, reviewer_id, status, assigned_at)
                VALUES ($1, $2, 'PENDING', NOW())
            `, [assignment.paper_session_id, assignment.reviewer_id]);
        }

        await client.query('COMMIT');

        // STEP 5: Group by reviewer for summary
        const pairsByReviewer = {};
        pairs.forEach((pair, index) => {
            const reviewer = reviewers[index % reviewers.length];
            if (!pairsByReviewer[reviewer.name]) {
                pairsByReviewer[reviewer.name] = 0;
            }
            pairsByReviewer[reviewer.name]++;
        });

        return NextResponse.json({
            success: true,
            message: `Successfully assigned ${pairs.length} bilingual paper pairs (${assignments.length} total papers)`,
            total_pairs: pairs.length,
            total_papers_assigned: assignments.length,
            pairs_by_reviewer: pairsByReviewer,
            reviewers_used: reviewers.length,
            cleared_old_assignments: deleteResult.rowCount
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
