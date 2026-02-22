import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-edge';
import db from '@/lib/db';
import AddBilingualQuestionForm from '@/components/AddBilingualQuestionForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
    return { title: 'Add Question — Hyrank' };
}

export default async function AddQuestionPage({ params }) {
    const { engSessionId } = await params;

    const user = await getCurrentUser();
    if (!user || !user.isAdmin) {
        redirect('/dashboard');
    }

    const client = await db.connect();

    try {
        // 1. Fetch English session info + PDF path
        const engSessionRes = await client.query(`
            SELECT 
                ps.paper_session_id,
                ps.session_label,
                ps.exam_id,
                ps.paper_date,
                ps.shift_number,
                j.source_pdf_path as pdf_path
            FROM paper_session ps
            LEFT JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
            LEFT JOIN import_job j ON d.import_job_id = j.import_job_id
            WHERE ps.paper_session_id = $1 AND ps.language = 'EN'
        `, [engSessionId]);

        if (engSessionRes.rows.length === 0) {
            redirect('/bilingdash');
        }

        const engSession = engSessionRes.rows[0];

        // 2. Find the matching Hindi session
        const hinSessionRes = await client.query(`
            SELECT 
                ps.paper_session_id,
                ps.session_label,
                j.source_pdf_path as pdf_path
            FROM paper_session ps
            LEFT JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
            LEFT JOIN import_job j ON d.import_job_id = j.import_job_id
            WHERE ps.exam_id = $1
              AND ps.paper_date = $2
              AND ps.shift_number = $3
              AND ps.language = 'HI'
            LIMIT 1
        `, [engSession.exam_id, engSession.paper_date, engSession.shift_number]);

        const hinSession = hinSessionRes.rows[0] || null;

        // 3. Fetch existing question numbers for the English session grid
        const engQNosRes = await client.query(`
            SELECT DISTINCT source_question_no 
            FROM question_version 
            WHERE paper_session_id = $1 AND source_question_no IS NOT NULL
            ORDER BY source_question_no
        `, [engSessionId]);
        const engQuestionNos = engQNosRes.rows.map(r => r.source_question_no);

        // 4. Fetch existing question numbers for the Hindi session grid
        let hinQuestionNos = [];
        if (hinSession) {
            const hinQNosRes = await client.query(`
                SELECT DISTINCT source_question_no 
                FROM question_version 
                WHERE paper_session_id = $1 AND source_question_no IS NOT NULL
                ORDER BY source_question_no
            `, [hinSession.paper_session_id]);
            hinQuestionNos = hinQNosRes.rows.map(r => r.source_question_no);
        }

        // 5. Fetch sections for the dropdown
        const sectionsRes = await client.query(`
            SELECT section_id, name, code
            FROM exam_section
            WHERE exam_id = $1
            ORDER BY sort_order ASC NULLS LAST, name ASC
        `, [engSession.exam_id]);
        const sections = sectionsRes.rows;

        return (
            <AddBilingualQuestionForm
                engSessionId={engSessionId}
                engSessionLabel={engSession.session_label}
                engPdfPath={engSession.pdf_path}
                hinSessionId={hinSession?.paper_session_id || null}
                hinSessionLabel={hinSession?.session_label || null}
                hinPdfPath={hinSession?.pdf_path || null}
                engQuestionNos={engQuestionNos}
                hinQuestionNos={hinQuestionNos}
                sections={sections}
            />
        );

    } catch (e) {
        console.error('Error loading add-question page:', e);
        redirect('/bilingdash');
    } finally {
        client.release();
    }
}
