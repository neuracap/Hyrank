
const processLatexImproved = (content) => {
    let processedContent = content
        .replace(/\\\((.*?)\\\)/g, '$$$1$$')

        // NEW REGEX
        // Matches \frac{...}{...} allowing one level of nested {}
        // part: (?:[^{}]|\{[^}]*\})+
        .replace(/(\\frac\{(?:[^{}]|\{[^}]*\})+\}\{(?:[^{}]|\{[^}]*\})+\})/g, '$$$1$$')

    return processedContent;
}

const samples = [
    "Simple: \\frac{1}{2}",
    "Nested: \\frac{2^{2}}{4}",
    "Complex: \\frac{\\text{hi}}{y}",
    "Broken: \\frac{1}{2",
];

samples.forEach(s => {
    console.log(`Original: ${s}`);
    console.log(`Processed: ${processLatexImproved(s)}`);
    console.log('---');
});
