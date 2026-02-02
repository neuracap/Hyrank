const http = require('http');

const data = JSON.stringify({
    difficulty: 'Hard',
    question_text: 'Updated Question Text via Script',
    has_figure: true
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/questions/1',
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
        console.log(`BODY: ${chunk}`);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
