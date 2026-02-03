const fs = require('fs');
const path = require('path');

// Try to load .env.local
try {
    const envPath = path.resolve(__dirname, '../.env.local');
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
    }
} catch (e) {
    console.log("Note: dotenv not loaded or error reading .env.local");
}

let cloudinary;
try {
    cloudinary = require('cloudinary').v2;
} catch (e) {
    console.error("Error: 'cloudinary' package is missing.");
    console.error("Please run: npm install cloudinary dotenv");
    process.exit(1);
}

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
    console.error("Error: Credentials missing. Ensure CLOUDINARY_XXX vars are in .env.local");
    process.exit(1);
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

function getFiles(dir) {
    const dirents = fs.readdirSync(dir, { withFileTypes: true });
    const files = dirents.map((dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFiles(res) : res;
    });
    return Array.prototype.concat(...files);
}

async function uploadFolder(localPath, remoteFolder) {
    console.log(`\nScanning: ${localPath}`);
    if (!fs.existsSync(localPath)) {
        console.error(`Path not found: ${localPath}`);
        return;
    }

    const files = getFiles(localPath);
    console.log(`Found ${files.length} files. Target: ${remoteFolder}`);

    let count = 0;
    for (const file of files) {
        // Build remote path: remoteFolder + relative path of file
        const relative = path.relative(localPath, file); // e.g. "subfolder\image.jpg"
        const relativeDir = path.dirname(relative).split(path.sep).join('/'); // "subfolder"

        let targetFolder = remoteFolder;
        if (relativeDir !== '.') {
            targetFolder = `${remoteFolder}/${relativeDir}`;
        }

        // Upload
        try {
            await cloudinary.uploader.upload(file, {
                folder: targetFolder,
                use_filename: true,
                unique_filename: false,
                overwrite: true,
                resource_type: "auto"
            });
            count++;
            if (count % 10 === 0) process.stdout.write(".");
        } catch (e) {
            console.error(`\nFailed: ${file} - ${e.message}`);
        }
    }
    console.log(`\nUpload complete. ${count}/${files.length} files uploaded.`);
}

(async () => {
    console.log("Starting Upload Script (Node.js)...");

    // 1. SSC-CGL Images
    const sscPath = 'C:\\Users\\Neuraedge\\Documents\\Divya\\MeritEdge\\Code\\adda_ssc\\mathpix_raw_zips\\ssc-cgl';
    await uploadFolder(sscPath, 'assets/ssc-cgl');

})();
