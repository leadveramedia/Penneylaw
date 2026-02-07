/**
 * Resize images to match actual display dimensions (2x for retina)
 * Based on PageSpeed Insights recommendations
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const IMAGES_DIR = path.join(__dirname, '..', 'images');

// Image configurations based on PageSpeed display dimensions
const resizeConfigs = {
    // Location images: displayed at 327x183, 2x = 654x366
    locations: {
        dir: path.join(IMAGES_DIR, 'locations'),
        files: [
            'Roseville-Personal-Injury-Lawyer-Frank-Penney-Injury-Law.webp',
            'Sacramento-Personal-Injury-Lawyer-Frank-Penney-Injury-Law.webp',
            'Fairfield-Personal-Injury-Lawyer-Frank-Penney-Injury-Law.webp',
            'Stockton-Personal-Injury-Lawyer-Frank-Penney-Injury-Law.webp',
            'Modesto-Personal-Injury-Lawyer-Frank-Penney-Injury-Law-1.webp',
            'Chico-Personal-Injury-Lawyer-Frank-Penney-Injury-Law.webp'
        ],
        width: 654,
        height: 366,
        quality: 85
    },
    // Attorney images: displayed at 120x180, 2x = 240x360
    attorneys: {
        dir: path.join(IMAGES_DIR, 'attorneys'),
        files: [
            'frank-penney.webp',
            'joshua-boyce.webp',
            'mark-mccauley.webp',
            'jacob-stoeltzing.webp'
        ],
        width: 240,
        height: 360,
        quality: 85
    },
    // Award images: displayed at 65x60, 2x = 130x120
    awards: {
        dir: path.join(IMAGES_DIR, 'backgrounds'),
        files: [
            { name: 'PenneyAward1.webp', width: 130, height: 120 },
            { name: 'PenneyAward2.webp', width: 130, height: 120 },
            { name: 'Best-of-the-Bar-Sacramento.webp', width: 340, height: 158 }
        ],
        quality: 85
    }
};

async function resizeImage(inputPath, width, height, quality) {
    const outputPath = inputPath; // Overwrite original
    const backupPath = inputPath.replace('.webp', '.backup.webp');

    // Create backup if doesn't exist
    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(inputPath, backupPath);
        console.log(`  Backup created: ${path.basename(backupPath)}`);
    }

    const originalStats = fs.statSync(inputPath);
    const originalSize = (originalStats.size / 1024).toFixed(1);

    await sharp(backupPath)
        .resize(width, height, {
            fit: 'cover',
            position: 'center'
        })
        .webp({ quality })
        .toFile(outputPath + '.tmp');

    // Replace original with resized
    fs.renameSync(outputPath + '.tmp', outputPath);

    const newStats = fs.statSync(outputPath);
    const newSize = (newStats.size / 1024).toFixed(1);
    const savings = ((originalStats.size - newStats.size) / originalStats.size * 100).toFixed(1);

    console.log(`  ${path.basename(inputPath)}: ${originalSize}KB -> ${newSize}KB (${savings}% savings)`);
}

async function processCategory(name, config) {
    console.log(`\n${name.toUpperCase()} IMAGES:`);
    console.log('='.repeat(50));

    for (const file of config.files) {
        let fileName, width, height;

        if (typeof file === 'object') {
            fileName = file.name;
            width = file.width;
            height = file.height;
        } else {
            fileName = file;
            width = config.width;
            height = config.height;
        }

        const filePath = path.join(config.dir, fileName);

        if (!fs.existsSync(filePath)) {
            console.log(`  SKIP: ${fileName} not found`);
            continue;
        }

        try {
            await resizeImage(filePath, width, height, config.quality);
        } catch (err) {
            console.error(`  ERROR: ${fileName}: ${err.message}`);
        }
    }
}

async function main() {
    console.log('Resizing images for PageSpeed optimization...\n');

    // Process each category
    await processCategory('locations', resizeConfigs.locations);
    await processCategory('attorneys', resizeConfigs.attorneys);
    await processCategory('awards', resizeConfigs.awards);

    console.log('\n✓ Image resizing complete!');
    console.log('\nNote: Original images backed up with .backup.webp extension');
    console.log('Remember to update HTML width/height attributes to match new dimensions.');
}

main().catch(console.error);
