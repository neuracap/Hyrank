
const processLatex = (content) => {
    let processedContent = content
        .replace(/\\\((.*?)\\\)/g, '$$$1$$') // \( ... \) -> $ ... $

        // Exponents
        .replace(/(\d+\^\{[^}]+\})/g, '$$$1$$')
        // Fractions (Improved)
        .replace(/(\\frac\{(?:[^{}]|\{[^}]*\})+\}\{(?:[^{}]|\{[^}]*\})+\})/g, '$$$1$$')

    return processedContent;
}

const samples = [
    "Correctly Wrapped by LLM: \\(\\frac{2^{2}}{4}\\)",
    "Naked (Legacy): \\frac{2^{2}}{4}",
];

samples.forEach(s => {
    console.log(`Input: ${s}`);
    console.log(`Output: ${processLatex(s)}`);
    // Check for nested $
    // e.g. $ \frac{ $...$ } ... $
    // We can simulate what happen by looking at output
    console.log('---');
});
