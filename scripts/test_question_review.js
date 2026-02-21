import fetch from 'node-fetch';

async function testApi() {
    const questionId = '32a06b87-e61b-4acc-8fff-ce72a9968efe'; // Sample ID
    const url = `http://localhost:3000/api/question-review?questionId=${questionId}`;

    console.log(`Testing API: ${url}`);

    // We cannot easily test the protected API via direct script without mocking auth
    // So we will just print what manual testing should be done.
    console.log('To manually test this:');
    console.log('1. Go to http://localhost:3000/question-review');
    console.log('2. Make sure you are logged in as Admin');
    console.log(`3. Enter ID: ${questionId}`);
    console.log('4. Verify both English and Hindi results show side-by-side');
}

testApi();
