import db from '@/lib/db';
import QuestionEditor from '@/components/QuestionEditor';

export const dynamic = 'force-dynamic';

export default async function QuestionPage({ params }) {
    const { id } = await params;

    const client = await db.connect();
    try {
        const questionRes = await client.query(`
            SELECT 
                qv.question_id as id, 
                qv.version_no,
                qv.difficulty,
                qv.meta_json->>'canonical_code' as exam,
                qv.body_json->>'text' as question_text,
                qv.has_image as has_figure,
                qv.meta_json
            FROM question_version qv
            WHERE qv.question_id = $1 AND qv.language = 'EN'
        `, [id]);

        const questionRow = questionRes.rows[0];

        if (!questionRow) {
            return <div className="container pt-20 text-center">Question not found</div>;
        }

        const question = {
            id: questionRow.id,
            q_no: questionRow.id.substring(0, 8),
            exam: questionRow.exam || '',
            question_text: questionRow.question_text || '',
            difficulty: questionRow.difficulty || '',
            subject: questionRow.meta_json ? questionRow.meta_json.section_name : '',
            has_figure: questionRow.has_figure,
            figure_path: '', // Parsing logic needed if path is embedded in md
            ...questionRow.meta_json // spread meta_json for other fields like subject, topic etc?
        };

        const optionsRes = await client.query(`
            SELECT 
                option_key as opt_label,
                option_json->>'text' as opt_text
            FROM question_option
            WHERE question_id = $1 AND language = 'EN'
            ORDER BY option_key ASC
        `, [id]);

        const options = optionsRes.rows;
        // Mock solutions for now as `llm_solutions` table might differ or not exist in new schema
        // Looking at schema dump, there is no llm_solutions table. question_version has solution_json.
        const llmSolutions = [];

        // Extract solution from solution_json if exists
        // Postgres inspect showed solution_json: null. Assuming if it exists, it might have text.
        // If questionRow.solution_json is fetched (I need to select it above)

        return (
            <div className="py-8">
                <QuestionEditor
                    initialData={question}
                    initialOptions={options}
                    initialSolutions={llmSolutions}
                />
            </div>
        );
    } catch (e) {
        console.error(e);
        return <div className="container pt-20 text-center">Error loading question</div>;
    } finally {
        client.release();
    }
}
