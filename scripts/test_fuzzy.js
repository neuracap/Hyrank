const fs = require('fs');

// Mock data
const session_label = "SSC-CGL-Tier-1-Question-Paper-English_26.09.2024_04:00 PM-05:00 PM";
const existingDirs = [
    "Combined Graduate Level Examination 2024 Tier I [SSC-CGL-Tier-1-Question-Paper-English_26.09.2024_04.00-PM-05.00-PM]",
    "SSC-CGL-Tier-1-Question-Paper-English_26.09.2024_04.00-PM-05.00-PM",
    "Random-Folder"
];

function findMatch(label, dirs) {
    const normalize = (s) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const target = normalize(label);

    console.log(`Target Normalized: ${target}`);

    const found = dirs.find(d => {
        const norm = normalize(d);
        // console.log(`Checking: ${d} -> ${norm}`);
        return norm === target;
    });

    return found;
}

const match = findMatch(session_label, existingDirs);
console.log(`Match for "${session_label}":\n => ${match ? match : 'Not Found'}`);
