import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const ROOT = process.cwd();
const LOGO_SVG = path.join(ROOT, "public/logo.svg");
const MASKABLE_SVG = path.join(ROOT, "scripts/icon-source-maskable.svg");

const PNG_TARGETS = [
  { file: "public/icons/icon-72x72.png", size: 72, source: LOGO_SVG },
  { file: "public/icons/icon-96x96.png", size: 96, source: LOGO_SVG },
  { file: "public/icons/icon-128x128.png", size: 128, source: LOGO_SVG },
  { file: "public/icons/icon-144x144.png", size: 144, source: LOGO_SVG },
  { file: "public/icons/icon-152x152.png", size: 152, source: LOGO_SVG },
  { file: "public/icons/icon-192x192.png", size: 192, source: LOGO_SVG },
  { file: "public/icons/icon-384x384.png", size: 384, source: LOGO_SVG },
  { file: "public/icons/icon-512x512.png", size: 512, source: LOGO_SVG },
  {
    file: "public/icons/icon-maskable-512x512.png",
    size: 512,
    source: MASKABLE_SVG,
  },
  { file: "public/apple-touch-icon.png", size: 180, source: LOGO_SVG },
  { file: "public/branding/logo.png", size: 512, source: LOGO_SVG },
];

const ICO_SIZES = [16, 32, 48];
const ICO_TARGETS = ["public/favicon.ico", "public/branding/favicon.ico"];

async function renderPng(source, size, outFile) {
  const outPath = path.join(ROOT, outFile);
  await mkdir(path.dirname(outPath), { recursive: true });
  const svgBuffer = await readFile(source);
  await sharp(svgBuffer).resize(size, size).png().toFile(outPath);

  const meta = await sharp(outPath).metadata();
  if (meta.width !== size || meta.height !== size) {
    throw new Error(
      `${outFile}: expected ${size}x${size}, got ${meta.width}x${meta.height}`,
    );
  }
  console.log(`  ok  ${outFile} (${meta.width}x${meta.height})`);
}

async function renderIco(outFile) {
  const outPath = path.join(ROOT, outFile);
  await mkdir(path.dirname(outPath), { recursive: true });

  const svgBuffer = await readFile(LOGO_SVG);
  const pngBuffers = await Promise.all(
    ICO_SIZES.map((size) => sharp(svgBuffer).resize(size, size).png().toBuffer()),
  );
  const icoBuffer = await pngToIco(pngBuffers);
  await writeFile(outPath, icoBuffer);

  const written = await readFile(outPath);
  const isIco =
    written.length > 4 &&
    written[0] === 0x00 &&
    written[1] === 0x00 &&
    written[2] === 0x01 &&
    written[3] === 0x00;
  if (!isIco) {
    throw new Error(`${outFile}: missing ICO magic bytes, got malformed file`);
  }
  console.log(`  ok  ${outFile} (${written.length} bytes, ICO header valid)`);
}

async function main() {
  console.log("Generating PNG icons...");
  for (const target of PNG_TARGETS) {
    await renderPng(target.source, target.size, target.file);
  }

  console.log("Generating ICO icons...");
  for (const outFile of ICO_TARGETS) {
    await renderIco(outFile);
  }

  console.log(
    `\nDone. Generated ${PNG_TARGETS.length} PNG + ${ICO_TARGETS.length} ICO files.`,
  );
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
