const { translate } = require('google-translate-api-x');

async function test() {
    try {
        console.log("Testing translation...");
        const res = await translate('Hello world. This is a \\textbf{test} of $x^2$.', { to: 'hi' });
        console.log("Result:", res.text);
    } catch (e) {
        console.error("Error:", e);
    }
}

test();
