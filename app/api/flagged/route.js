import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const user = await getCurrentUser();

    if (!user || !user.isAdmin) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = (page - 1) * limit;

    const client = await db.connect();

    try {
        const query = `
            SELECT 
                ql.id as link_id,
                ql.similarity_score,
                ql.updated_score,
                ql.status,
                ql.paper_session_id_english as eng_session_id,
                ql.paper_session_id_hindi as hin_session_id,
                
                -- English Question
                qe.question_id as eng_id,
                qe.version_no as eng_version,
                qe.body_json->>'text' as eng_text,
                qe.has_image as eng_has_figure,
                qe.source_question_no as eng_source_no,
                qe.exam_section_id as eng_section_id,
                qe.difficulty as eng_difficulty,
                
                -- Hindi Question
                qh.question_id as hin_id,
                qh.version_no as hin_version,
                qh.body_json->>'text' as hin_text,
                qh.has_image as hin_has_figure,
                qh.source_question_no as hin_source_no,
                qh.exam_section_id as hin_section_id,
                
                -- PDFs & MMD
                pe_ij.source_pdf_path as eng_source_pdf,
                ph_ij.source_pdf_path as hin_source_pdf,
                pe_doc.raw_mmd_doc_id as eng_mmd_doc_id,
                ph_doc.raw_mmd_doc_id as hin_mmd_doc_id,
                
                ql.translated_debug
            FROM question_links ql
            JOIN question_version qe ON (ql.english_question_id = qe.question_id AND ql.english_version_no = qe.version_no)
            LEFT JOIN question_version qh ON (ql.hindi_question_id = qh.question_id AND ql.hindi_version_no = qh.version_no AND qh.language = 'HI')
            
            -- English PDF Joins
            LEFT JOIN paper_session pe ON ql.paper_session_id_english = pe.paper_session_id
            LEFT JOIN raw_mmd_doc pe_doc ON pe.raw_mmd_doc_id = pe_doc.raw_mmd_doc_id
            LEFT JOIN import_job pe_ij ON pe_doc.import_job_id = pe_ij.import_job_id
            
            -- Hindi PDF Joins
            LEFT JOIN paper_session ph ON ql.paper_session_id_hindi = ph.paper_session_id
            LEFT JOIN raw_mmd_doc ph_doc ON ph.raw_mmd_doc_id = ph_doc.raw_mmd_doc_id
            LEFT JOIN import_job ph_ij ON ph_doc.import_job_id = ph_ij.import_job_id
            
            WHERE ql.status = 'FLAGGED'
            ORDER BY ql.created_at ASC
            LIMIT $1 OFFSET $2;
        `;

        const res = await client.query(query, [limit, offset]);
        const links = res.rows;

        // Fetch Count
        const countRes = await client.query(`
            SELECT COUNT(id) as c
            FROM question_links
            WHERE status = 'FLAGGED'
        `);
        const total = parseInt(countRes.rows[0].c, 10);

        const engIds = links.map(l => l.eng_id).filter(Boolean);
        const hinIds = links.map(l => l.hin_id).filter(Boolean);
        const allIds = [...new Set([...engIds, ...hinIds])];

        let allOptions = [];
        if (allIds.length > 0) {
            const optionsRes = await client.query(`
                SELECT 
                    question_id,
                    version_no,
                    language,
                    option_key as opt_label,
                    option_json->>'text' as opt_text
                FROM question_option
                WHERE question_id = ANY($1)
                ORDER BY option_key ASC
            `, [allIds]);
            allOptions = optionsRes.rows;
        }

        // Attach options
        const questions = links.map(link => ({
            ...link,
            engDocInfo: { source_pdf_path: link.eng_source_pdf },
            hinDocInfo: { source_pdf_path: link.hin_source_pdf },
            eng_options: allOptions.filter(o => o.question_id === link.eng_id && o.version_no === link.eng_version && o.language === 'EN'),
            hin_options: allOptions.filter(o => o.question_id === link.hin_id && o.version_no === link.hin_version && o.language === 'HI')
        }));

        return Response.json({ success: true, data: questions, total, page, totalPages: Math.ceil(total / limit) });

    } catch (e) {
        console.error('Error fetching flagged questions:', e);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    } finally {
        client.release();
    }
}
