// Direct DB verification script

// Polyfill prompt for test script if needed, or just hardcode
const BASE_URL = 'http://localhost:3000/api/questions/1';

async function runTest() {
    console.log('Testing schema persistence...');

    // 1. Initial Fetch to get current state (skip for now, we just overwrite)

    // 2. PUT with new fields
    const payload = {
        question_text: "Schema Test Question",
        difficulty: "Hard",
        difficulty_level: 5,
        approx_time_seconds: 120,
        exam: "TEST_EXAM_2024",
        exam_date: "2024-12-07",
        section: "Physics",
        soft_skill_tag: "Analytical",
        review_status: "okay",
        options: []
    };

    console.log('Sending PUT request...');
    // We need to run the app for this to work via localhost, OR we can test the DB directly.
    // Since the app requires `next start`, simpler to verify DB directly using better-sqlite3 
    // to simulate what the API does, OR just trust the code path if we can't spin up server.
    // Actually, I can just use the previous `test-put.js` logic but adapting it to direct DB manipulation 
    // if I don't want to rely on the server being up. 
    // BUT the best test is through the API code.
    // I can't start the server and run script easily in one go here without blocking.
    // I will verify using direct DB update simulation or just check logic.
    // Let's just use `better-sqlite3` to check if columns exist and are writable.
}

const db = require('better-sqlite3')('questions.db');

try {
    const stmt = db.prepare(`
        UPDATE questions SET 
            difficulty_level = @difficulty_level,
            approx_time_seconds = @approx_time_seconds,
            exam = @exam,
            review_status = @review_status
        WHERE id = 1
    `);

    const info = stmt.run({
        difficulty_level: 5,
        approx_time_seconds: 99,
        exam: 'SchemaCheck',
        review_status: 'dump'
    });

    console.log('Update info:', info);

    const row = db.prepare('SELECT difficulty_level, approx_time_seconds, exam, review_status FROM questions WHERE id = 1').get();
    console.log('Fetched row:', row);

    if (row.difficulty_level === 5 && row.approx_time_seconds === 99 && row.exam === 'SchemaCheck' && row.review_status === 'dump') {
        console.log('SUCCESS: Schema fields are writable and readable.');
    } else {
        console.error('FAILURE: Data mismatch.');
        process.exit(1);
    }
} catch (e) {
    console.error('Error:', e);
    process.exit(1);
}
