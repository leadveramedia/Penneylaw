const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const locationsDir = path.join(__dirname, '..', 'images', 'locations');

// Target display size is ~327x184, we'll create 2x for retina (654x368)
// Rounding to 660x370 for cleaner dimensions
const TARGET_WIDTH = 660;
const TARGET_HEIGHT = 370;

async function resizeImages() {
    const files = fs.readdirSync(locationsDir);

    for (const file of files) {
        if (file.endsWith('.webp')) {
            const inputPath = path.join(locationsDir, file);
            const tempPath = path.join(locationsDir, `temp-${file}`);

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
                        position: 'center'
                    })
                    .webp({ quality: 80 })
                    .toFile(tempPath);

                // Replace original with resized
                fs.unlinkSync(inputPath);
                fs.renameSync(tempPath, inputPath);

                const newMetadata = await sharp(inputPath).metadata();
                const oldSize = metadata.size || fs.statSync(inputPath).size;
                const newSize = fs.statSync(inputPath).size;
                console.log(`  -> Done! New size: ${newMetadata.width}x${newMetadata.height}, File: ${Math.round(newSize/1024)}KB`);

            } catch (err) {
                console.error(`Error processing ${file}:`, err.message);
            }
        }
    }

    console.log('\nLocation image resizing complete!');
}

resizeImages();
