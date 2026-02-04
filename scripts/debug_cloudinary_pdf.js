require('dotenv').config({ path: '.env.local' });
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

async function findTargetFile() {
    const filename = 'SSC-CGL-QUESTION-PAPER-13-June-2019-Shift-3-English';
    console.log("Searching globally for:", filename);

    // Try multiple strategies
    const queries = [
        `resource_type:image AND public_id:*${filename}*`, // Contains
        `resource_type:image AND filename:${filename}`,    // Exact filename field
    ];

    for (const q of queries) {
        try {
            console.log(`Query: ${q}`);
            const res = await cloudinary.search.expression(q).execute();
            console.log(`Matches: ${res.total_count}`);
            if (res.resources.length > 0) {
                console.log("Found:", res.resources[0].secure_url);
                return;
            }
        } catch (e) {
            console.log("Error:", e.message);
        }
    }
    console.log("File not found via any strategy.");
}

findTargetFile();
