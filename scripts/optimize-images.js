const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Images to optimize with their target dimensions
const imagesToOptimize = [
  // Hero background - keep high quality but convert to WebP
  {
    input: 'images/backgrounds/Billboard-Graphic-scaled.png',
    output: 'images/backgrounds/Billboard-Graphic-scaled.webp',
    width: 1920,
    quality: 85
  },
  // Team photo - displayed at ~637x425
  {
    input: 'images/attorneys/frankpenney Team.png',
    output: 'images/attorneys/frankpenney-team.webp',
    width: 800,
    quality: 85
  },
  // Logo - displayed at ~337x79
  {
    input: 'images/logos/Frank Penney black logo.png',
    output: 'images/logos/frank-penney-logo.webp',
    width: 400,
    quality: 90
  },
  // Footer logo
  {
    input: 'images/logos/FP-Logo-Dark-Background.png',
    output: 'images/logos/fp-logo-dark.webp',
    width: 250,
    quality: 90
  },
  // Attorney photos - displayed at ~210x315
  {
    input: 'images/attorneys/frank-penney.jpg',
    output: 'images/attorneys/frank-penney.webp',
    width: 420,
    quality: 85
  },
  {
    input: 'images/attorneys/jacob-stoeltzing.png',
    output: 'images/attorneys/jacob-stoeltzing.webp',
    width: 420,
    quality: 85
  },
  // Award badges - displayed at ~85-210px wide
  {
    input: 'images/backgrounds/4-8-Rating.png',
    output: 'images/backgrounds/4-8-Rating.webp',
    width: 250,
    quality: 85
  },
  {
    input: 'images/backgrounds/Best-of-the-Bar-Sacramento.png',
    output: 'images/backgrounds/Best-of-the-Bar-Sacramento.webp',
    width: 200,
    quality: 85
  },
  {
    input: 'images/backgrounds/sacramento-superlawyers.png',
    output: 'images/backgrounds/sacramento-superlawyers.webp',
    width: 100,
    quality: 85
  },
  {
    input: 'images/backgrounds/bbb-1920w.png',
    output: 'images/backgrounds/bbb.webp',
    width: 150,
    quality: 85
  },
  // Practice area images
  {
    input: 'images/practice-areas/California-Car-Accident-Lawyer.png',
    output: 'images/practice-areas/car-accident.webp',
    width: 800,
    quality: 80
  },
  {
    input: 'images/practice-areas/Truck-Accident-Lawyer.png',
    output: 'images/practice-areas/truck-accident.webp',
    width: 800,
    quality: 80
  },
  {
    input: 'images/practice-areas/Motorcycle-Accident-Attorney-in-California.png',
    output: 'images/practice-areas/motorcycle-accident.webp',
    width: 800,
    quality: 80
  },
  {
    input: 'images/practice-areas/Wrongful-Death-Lawyer.png',
    output: 'images/practice-areas/wrongful-death.webp',
    width: 800,
    quality: 80
  },
  {
    input: 'images/practice-areas/California-Slip-and-Fall-Accident.png',
    output: 'images/practice-areas/slip-and-fall.webp',
    width: 800,
    quality: 80
  },
  {
    input: 'images/practice-areas/Dog-Bite-Lawyer.png',
    output: 'images/practice-areas/dog-bite.webp',
    width: 800,
    quality: 80
  }
];

const baseDir = path.join(__dirname, '..');

async function optimizeImage(config) {
  const inputPath = path.join(baseDir, config.input);
  const outputPath = path.join(baseDir, config.output);

  // Check if input file exists
  if (!fs.existsSync(inputPath)) {
    console.log(`Skipping ${config.input} - file not found`);
    return;
  }

  try {
    const inputStats = fs.statSync(inputPath);
    const inputSizeKB = (inputStats.size / 1024).toFixed(1);

    await sharp(inputPath)
      .resize(config.width, null, { withoutEnlargement: true })
      .webp({ quality: config.quality })
      .toFile(outputPath);

    const outputStats = fs.statSync(outputPath);
    const outputSizeKB = (outputStats.size / 1024).toFixed(1);
    const savings = ((1 - outputStats.size / inputStats.size) * 100).toFixed(1);

    console.log(`${config.input}`);
    console.log(`  ${inputSizeKB} KB -> ${outputSizeKB} KB (${savings}% smaller)`);
    console.log(`  Output: ${config.output}\n`);
  } catch (error) {
    console.error(`Error processing ${config.input}:`, error.message);
  }
}

async function main() {
  console.log('Image Optimization Script');
  console.log('='.repeat(50));
  console.log('');

  for (const config of imagesToOptimize) {
    await optimizeImage(config);
  }

  console.log('='.repeat(50));
  console.log('Done! WebP images created.');
  console.log('\nNext steps:');
  console.log('1. Update HTML to use <picture> elements with WebP sources');
  console.log('2. Update CSS background-image to use WebP with fallback');
}

main().catch(console.error);
