const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'questions.db');
const db = new Database(dbPath);

const insertQuestion = db.prepare(`
    INSERT INTO questions (q_no, exam, question_text, has_figure, difficulty, subject, topic)
    VALUES (@q_no, @exam, @question_text, @has_figure, @difficulty, @subject, @topic)
`);

const insertOption = db.prepare(`
    INSERT INTO options (question_id, opt_label, opt_text)
    VALUES (@question_id, @opt_label, @opt_text)
`);

const insertSolution = db.prepare(`
    INSERT INTO llm_solutions (question_id, llm_solution_text, llm_answer_label)
    VALUES (@question_id, @llm_solution_text, @llm_answer_label)
`);

const runSeed = db.transaction(() => {
    // Check if data exists
    const count = db.prepare('SELECT count(*) as c FROM questions').get().c;
    if (count > 0) {
        console.log('Database already has data. Skipping seed.');
        return;
    }

    // Insert Question 1
    const info1 = insertQuestion.run({
        q_no: 1,
        exam: 'JEE Main 2024',
        question_text: 'What is the integration of $ \\int x^2 dx $?',
        has_figure: 0,
        difficulty: 'Easy',
        subject: 'Mathematics',
        topic: 'Calculus'
    });

    const qId1 = info1.lastInsertRowid;

    insertOption.run({ question_id: qId1, opt_label: 'a', opt_text: '$ \\frac{x^3}{3} + C $' });
    insertOption.run({ question_id: qId1, opt_label: 'b', opt_text: '$ x^3 + C $' });
    insertOption.run({ question_id: qId1, opt_label: 'c', opt_text: '$ 2x + C $' });
    insertOption.run({ question_id: qId1, opt_label: 'd', opt_text: '$ \\frac{x^2}{2} + C $' });

    insertSolution.run({
        question_id: qId1,
        llm_solution_text: 'Use power rule: $ \\int x^n dx = \\frac{x^{n+1}}{n+1} $. Here $n=2$. So $ \\frac{x^3}{3} $',
        llm_answer_label: 'a'
    });

    console.log('Seeded database with sample questions.');
});

try {
    runSeed();
} catch (err) {
    console.error('Error seeding database:', err);
}
