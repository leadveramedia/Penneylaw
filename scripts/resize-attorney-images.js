const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const attorneysDir = path.join(__dirname, '..', 'images', 'attorneys');

// Target display size is 210x315, we'll create 2x for retina (420x630)
const TARGET_WIDTH = 420;
const TARGET_HEIGHT = 630;

const imagesToResize = ['joshua-boyce.webp', 'mark-mccauley.webp'];

async function resizeImages() {
    for (const file of imagesToResize) {
        const inputPath = path.join(attorneysDir, file);
        const tempPath = path.join(attorneysDir, `temp-${file}`);

        if (!fs.existsSync(inputPath)) {
            console.log(`Skipping ${file} - file not found`);
            continue;
        }

        try {
            const metadata = await sharp(inputPath).metadata();

            // Skip if already at target size or smaller
            if (metadata.width <= TARGET_WIDTH) {
                console.log(`Skipping ${file} - already optimized (${metadata.width}x${metadata.height})`);
                continue;
            }

            console.log(`Resizing ${file} from ${metadata.width}x${metadata.height} to ${TARGET_WIDTH}x${TARGET_HEIGHT}`);

            await sharp(inputPath)
                .resize(TARGET_WIDTH, TARGET_HEIGHT, {
                    fit: 'cover',
                    position: 'top'  // Keep face in frame
                })
                .webp({ quality: 85 })
                .toFile(tempPath);

            // Replace original with resized
            fs.unlinkSync(inputPath);
            fs.renameSync(tempPath, inputPath);

            const newSize = fs.statSync(inputPath).size;
            console.log(`  -> Done! File: ${Math.round(newSize/1024)}KB`);

        } catch (err) {
            console.error(`Error processing ${file}:`, err.message);
        }
    }

    console.log('\nAttorney image resizing complete!');
}

resizeImages();
