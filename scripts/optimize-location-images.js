const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const locationsDir = path.join(__dirname, '..', 'images', 'locations');

// Define output sizes
const sizes = [
    { width: 400, suffix: '-400w' },  // Mobile/small displays
    { width: 654, suffix: '' }         // Desktop (original size)
];

async function optimizeImages() {
    const files = fs.readdirSync(locationsDir);

    for (const file of files) {
        // Only process original webp files (not already sized)
        if (file.endsWith('.webp') && !file.includes('-400w') && !file.includes('.backup')) {
            const inputPath = path.join(locationsDir, file);
            const baseName = file.replace('.webp', '');

            for (const size of sizes) {
                const outputName = `${baseName}${size.suffix}.webp`;
                const outputPath = path.join(locationsDir, outputName);

                // Skip if this is the original size and file exists
                if (size.suffix === '' && fs.existsSync(outputPath)) {
                    console.log(`Skipping ${outputName} - already exists`);
                    continue;
                }

                // Skip if sized version already exists
                if (size.suffix !== '' && fs.existsSync(outputPath)) {
                    console.log(`Skipping ${outputName} - already exists`);
                    continue;
                }

                try {
                    await sharp(inputPath)
                        .resize(size.width, null, {
                            withoutEnlargement: true,
                            fit: 'inside'
                        })
                        .webp({ quality: 80 })
                        .toFile(outputPath);

                    const stats = fs.statSync(outputPath);
                    console.log(`Created: ${outputName} (${Math.round(stats.size / 1024)}KB)`);
                } catch (err) {
                    console.error(`Error creating ${outputName}:`, err.message);
                }
            }
        }
    }

    console.log('\nLocation image optimization complete!');
}

optimizeImages();
