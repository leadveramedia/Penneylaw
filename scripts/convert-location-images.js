const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const locationsDir = path.join(__dirname, '..', 'images', 'locations');

async function convertToWebP() {
    const files = fs.readdirSync(locationsDir);

    for (const file of files) {
        if (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')) {
            const inputPath = path.join(locationsDir, file);
            const outputName = file.replace(/\.(jpg|jpeg|png)$/i, '.webp');
            const outputPath = path.join(locationsDir, outputName);

            // Skip if WebP already exists
            if (fs.existsSync(outputPath)) {
                console.log(`Skipping ${file} - WebP already exists`);
                continue;
            }

            try {
                await sharp(inputPath)
                    .webp({ quality: 80 })
                    .toFile(outputPath);
                console.log(`Converted: ${file} -> ${outputName}`);
            } catch (err) {
                console.error(`Error converting ${file}:`, err.message);
            }
        }
    }

    console.log('Location image conversion complete!');
}

convertToWebP();
