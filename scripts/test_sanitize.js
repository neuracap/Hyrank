const sanitize = (str) => str.replace(/[<>:"/\\|?*]/g, '-').trim();

const testCases = [
    "SSC CGL : Tier 1",
    "Date/Time-Checker",
    "InvalidChars<>*?",
    "Normal Session",
    "   Trim Me   "
];

testCases.forEach(t => {
    console.log(`Original: "${t}" -> Sanitized: "${sanitize(t)}"`);
});
