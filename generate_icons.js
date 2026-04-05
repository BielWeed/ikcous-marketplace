const fs = require('node:fs');
const path = require('path');
const { execSync } = require('child_process');

// Install sharp if it doesn't exist just for this script
try {
    require('sharp');
} catch (e) {
    console.log('Installing sharp...');
    execSync('npm install --no-save sharp', { stdio: 'inherit' });
}

const sharp = require('sharp');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputSvg = path.join(__dirname, 'public', 'logo.svg');
const outputDir = path.join(__dirname, 'public', 'icons');

async function generate() {
    console.log('Reading:', inputSvg);
    try {
        const svgBuffer = fs.readFileSync(inputSvg);

        for (const size of sizes) {
            const outputPath = path.join(outputDir, `icon-${size}x${size}.png`);
            await sharp(svgBuffer)
                .resize(size, size)
                .png()
                .toFile(outputPath);
            console.log(`Generated: icon-${size}x${size}.png`);
        }

        // Also overwrite favicon.ico if possible, or just skip it since PWA usually relies on sizes if configured with icon-*.png
        console.log('All icons generated successfully!');
    } catch (error) {
        console.error('Error generating icons:', error);
    }
}

generate();
