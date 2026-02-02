// Mock data
const session_label = "Unlimited Re-Attempt [SSC-CGL-Tier-1-Question-Paper-English_26.09.2024_9.00-AM-10.00-AM]";
const existingDirs = [
    "Combined Graduate Level Examination 2024 Tier I [SSC-CGL-Tier-1-Question-Paper-English_26.09.2024_04.00-PM-05.00-PM]",
    "SSC-CGL-Tier-1-Question-Paper-English_26.09.2024_9.00-AM-10.00-AM", // The target
    "Random-Folder"
];

function findMatch(label, dirs) {
    const normalize = (s) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const target = normalize(label);

    // Strategy 1: Exact Match (Normalized)
    let found = dirs.find(d => normalize(d) === target);
    if (found) return { method: 'exact', dir: found };

    // Strategy 2: Label contains Directory (Substring) - robust for "Prefix [DirName]"
    // We sort dirs by length descending to match the most specific directory first
    const sortedDirs = [...dirs].sort((a, b) => b.length - a.length);
    found = sortedDirs.find(d => {
        const normD = normalize(d);
        // Ensure the directory name is substantial enough to avoid false positives with short names
        if (normD.length < 10) return false;
        return target.includes(normD);
    });
    if (found) return { method: 'substring', dir: found };

    // Strategy 3: Bracket Extraction
    const bracketMatch = label.match(/\[(.*?)\]/);
    if (bracketMatch) {
        const inside = normalize(bracketMatch[1]);
        found = dirs.find(d => normalize(d).includes(inside)); // Dir contains the ID?
        if (found) return { method: 'bracket', dir: found };

        // Or Dir IS the ID?
        found = dirs.find(d => normalize(d) === inside);
        if (found) return { method: 'bracket-exact', dir: found };
    }

    return null;
}

const match = findMatch(session_label, existingDirs);
console.log(`Match for "${session_label}":`);
if (match) {
    console.log(`=> Found: "${match.dir}" via ${match.method}`);
} else {
    console.log("=> Not Found");
}
