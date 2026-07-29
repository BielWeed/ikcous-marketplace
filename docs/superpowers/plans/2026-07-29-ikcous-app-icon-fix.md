# IKCOUS App Icon Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every rasterized app-icon asset (PWA install icons, apple-touch-icon, favicon) currently showing the old SR Tudo10 pink logo with the correct IKCOUS mark, generated from the existing `public/logo.svg`.

**Architecture:** A committed Node script (`scripts/generate-app-icons.mjs`) uses `sharp` to rasterize `public/logo.svg` (and a maskable-safe variant) into every required PNG size, and `png-to-ico` to pack 16/32/48px renders into multi-resolution `.ico` files. The script writes 13 files directly into `public/icons/`, `public/branding/`, and `public/`, and self-verifies each output's dimensions/format before reporting success. A one-line cache-buster bump in `src/config/branding.ts` ensures already-visited browsers pick up the new files.

**Tech Stack:** Node.js (ESM, `"type": "module"` already set in `package.json`), `sharp` (SVG rasterization/resizing), `png-to-ico` (ICO packing), both added as devDependencies.

## Global Constraints

- Source of truth for all icon content is `public/logo.svg` (512×512, `rect rx="116" fill="#18181b"` + centered bold italic white "I", `font-size="300"`) — do not hand-edit pixel content anywhere else.
- Do not modify `public/logo.svg`, `public/favicon.svg`, or `public/branding/logo.svg` (the SVGs) — they are already correct.
- Do not touch anything outside the icon system: no changes to colors, copy/text strings, product images, or `og-image.png` (explicitly out of scope per the design spec).
- Do not modify `src/config/branding.ts`'s `applyBranding()` logic — only the hardcoded `?v=2` cache-buster string changes to `?v=3`.
- `cart-96x96.png` and `heart-96x96.png` in `public/icons/` are unrelated UI glyphs — never touch them.

---

### Task 1: Add generation dependencies and create the maskable-safe source SVG

**Files:**
- Modify: `package.json` (adds `sharp`, `png-to-ico` to `devDependencies`)
- Create: `scripts/icon-source-maskable.svg`

**Interfaces:**
- Produces: `scripts/icon-source-maskable.svg` — a 512×512 SVG, full-bleed square (no rounded corners) background `#18181b`, centered bold italic white "I" identical in position/size to `public/logo.svg`. Consumed by Task 2's generation script as the source for the maskable icon variant only.

- [ ] **Step 1: Install the two devDependencies**

Run:
```bash
npm install --save-dev sharp png-to-ico
```

- [ ] **Step 2: Verify install**

Run: `node -e "require.resolve('sharp'); require.resolve('png-to-ico'); console.log('ok')"`
Expected output: `ok`

- [ ] **Step 3: Create the maskable-safe source SVG**

Create `scripts/icon-source-maskable.svg` with this exact content — identical to `public/logo.svg` except `rx="0"` (maskable icons must fill edge-to-edge with no transparent/rounded corners, since the OS applies its own mask shape on top; the "I" glyph is already well inside the safe zone at this size):

```xml
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="0" fill="#18181b" />
  <text
    x="50%"
    y="50%"
    dominant-baseline="central"
    text-anchor="middle"
    font-family="system-ui, -apple-system, sans-serif"
    font-weight="900"
    font-style="italic"
    font-size="300"
    fill="#ffffff"
  >I</text>
</svg>
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json scripts/icon-source-maskable.svg
git commit -m "chore: add sharp/png-to-ico devDependencies and maskable icon source"
```

---

### Task 2: Write the icon generation script

**Files:**
- Create: `scripts/generate-app-icons.mjs`

**Interfaces:**
- Consumes: `public/logo.svg` (regular icon source, unchanged from Task 1 baseline), `scripts/icon-source-maskable.svg` (produced by Task 1).
- Produces (on execution, verified by Task 3): all 13 files listed in the "Files to regenerate" table of the design spec, written to `public/icons/*.png`, `public/apple-touch-icon.png`, `public/branding/logo.png`, `public/favicon.ico`, `public/branding/favicon.ico`.

- [ ] **Step 1: Write the script**

Create `scripts/generate-app-icons.mjs`:

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add scripts/generate-app-icons.mjs
git commit -m "feat: add app icon generation script"
```

---

### Task 3: Run the generation script and verify output

**Files:**
- Generates (binary, no hand-editing): `public/icons/icon-72x72.png`, `public/icons/icon-96x96.png`, `public/icons/icon-128x128.png`, `public/icons/icon-144x144.png`, `public/icons/icon-152x152.png`, `public/icons/icon-192x192.png`, `public/icons/icon-384x384.png`, `public/icons/icon-512x512.png`, `public/icons/icon-maskable-512x512.png`, `public/apple-touch-icon.png`, `public/branding/logo.png`, `public/favicon.ico`, `public/branding/favicon.ico`

**Interfaces:**
- Consumes: `scripts/generate-app-icons.mjs` from Task 2.
- Produces: the 13 regenerated binary asset files, consumed visually by the app at runtime — no further tasks depend on their exact bytes, only their existence at these exact paths (already fixed by `index.html`, `vite.config.ts`, and `src/config/branding.ts`, none of which change in this plan except the cache-buster in Task 4).

- [ ] **Step 1: Run the script**

Run:
```bash
node scripts/generate-app-icons.mjs
```
Expected: 11 `ok  <file> (WxH)` lines for the PNGs, 2 `ok  <file> (N bytes, ICO header valid)` lines for the ICOs, then `Done. Generated 11 PNG + 2 ICO files.` If any line fails, the script exits non-zero with `FAILED: <reason>` — stop and fix before continuing.

- [ ] **Step 2: Visually confirm the smallest and largest PNGs render correctly**

Read (open as image) `public/icons/icon-72x72.png` and `public/icons/icon-512x512.png`. Confirm both show: a solid dark (`#18181b`, near-black) rounded-square background and a crisp white italic "I", no pink, no artifacts, no leftover SR wordmark.

- [ ] **Step 3: Visually confirm the maskable variant has square (non-rounded) edges**

Read (open as image) `public/icons/icon-maskable-512x512.png`. Confirm the background fills to all four corners with no rounding and no transparency, "I" centered.

- [ ] **Step 4: Confirm old SR asset bytes are gone**

Run:
```bash
git status --short public/icons public/branding public/apple-touch-icon.png public/favicon.ico
```
Expected: all 13 files listed as modified (`M`), confirming the script overwrote the previous SR Tudo10 binaries in place rather than leaving them untouched.

- [ ] **Step 5: Commit the generated assets**

```bash
git add public/icons public/apple-touch-icon.png public/branding/logo.png public/branding/favicon.ico public/favicon.ico
git commit -m "fix: regenerate app icons with IKCOUS mark, replacing SR Tudo10 leftovers"
```

---

### Task 4: Bump the branding cache-buster and verify the production build

**Files:**
- Modify: `src/config/branding.ts` (the two `?v=2` occurrences inside `applyBranding()`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks — this is the final task.

- [ ] **Step 1: Bump the cache-buster**

In `src/config/branding.ts`, inside `applyBranding()`, change both occurrences:
```typescript
favicon.setAttribute("href", "/branding/favicon.ico?v=2");
```
to:
```typescript
favicon.setAttribute("href", "/branding/favicon.ico?v=3");
```
and:
```typescript
appleTouch.setAttribute("href", "/branding/logo.png?v=2");
```
to:
```typescript
appleTouch.setAttribute("href", "/branding/logo.png?v=3");
```

- [ ] **Step 2: Confirm the change**

Run: `grep -n "branding/favicon.ico?v=\|branding/logo.png?v=" src/config/branding.ts`
Expected: both lines show `?v=3`.

- [ ] **Step 3: Run the production build**

Run:
```bash
npm run build
```
Expected: build completes with exit code 0, no errors from `vite-plugin-pwa` about missing/invalid icon files referenced in the manifest (`icons/icon-192x192.png`, `icons/icon-512x512.png`).

- [ ] **Step 4: Commit**

```bash
git add src/config/branding.ts
git commit -m "fix: bump branding icon cache-buster so new icons are picked up"
```

---

## Post-plan note for the user

A device that already has this PWA installed to its home screen may keep showing the old cached icon until the app is removed and re-added, or until the OS refreshes its icon cache — this is normal PWA/OS behavior, not a sign the fix failed.
