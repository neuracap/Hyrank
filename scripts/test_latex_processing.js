
const processLatex = (content) => {
    let processedContent = content
        .replace(/\\begin\{figure\}/g, '')
        .replace(/\\end\{figure\}/g, '')
        .replace(/\\captionsetup\{.*?\}/g, '')
        .replace(/\\caption\{(.*?)\}/g, '\n*$1*\n')
        .replace(/\\includegraphics(?:\[.*?\])?\{(.*?)\}/g, '![]($1)')
        .replace(/\\begin\{tabular\}\{.*?\}([\s\S]*?)\\end\{tabular\}/g, (match, tableContent) => {
            return match; // simplified
        })
        .replace(/\\\((.*?)\\\)/g, '$$$1$$') // \( ... \) -> $ ... $
        .replace(/\\\[(.*?)\\\]/g, '$$$$$1$$$$') // \[ ... \] -> $$ ... $$

        // OLD REGEX being tested
        // 2. Fractions: \frac{a}{b} -> $\frac{a}{b}$
        .replace(/(\\frac\{[^}]+\}\{[^}]+\})/g, '$$$1$$')

    return processedContent;
}

const samples = [
    "Simple: \\frac{1}{2}",
    "Nested: \\frac{2^{2}}{4}",
    "Deep Nest: \\frac{\\text{hi}}{2}",
    "Wrapped: \\(\\frac{1}{2}\\)",
];

samples.forEach(s => {
    console.log(`Original: ${s}`);
    console.log(`Processed: ${processLatex(s)}`);
    console.log('---');
});
