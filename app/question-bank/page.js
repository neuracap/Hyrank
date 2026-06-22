import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import QuestionBankBrowser from '@/components/QuestionBankBrowser';

export const dynamic = 'force-dynamic';

export default async function QuestionBankPage() {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        redirect('/login');
    }

    let exams = [];
    try {
        // Only surface exams that have at least one question_version, so the
        // dropdown doesn't list dead exams.
        const res = await db.query(`
            SELECT DISTINCT e.exam_id, e.name
            FROM exam e
            JOIN exam_section es ON es.exam_id = e.exam_id
            JOIN question_version qv ON qv.exam_section_id = es.section_id
            ORDER BY e.name ASC
        `);
        exams = res.rows;
    } catch (err) {
        console.error('QuestionBankPage exams query error:', err);
    }

    return <QuestionBankBrowser exams={exams} />;
}
