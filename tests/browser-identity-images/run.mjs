/* eslint-disable security/detect-non-literal-fs-filename -- Paths use a fixed evidence root and source/fixture names defined in this harness, never caller input. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import sharp from "sharp";

const root = fileURLToPath(new URL("../../", import.meta.url));
const central =
  "C:/Users/Gabriel/equipe/entregas/20260909-codex-investigacao-ikcous";
const output = path.join(
  central,
  `tarefa-A5c2a-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
);
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["tests/browser-identity-images/entry.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome150",
  tsconfigRaw: { compilerOptions: { target: "ES2022", module: "ESNext" } },
  write: false,
  metafile: true,
  minify: false,
});
const js = bundle.outputFiles[0].contents;
const inputs = Object.keys(bundle.metafile.inputs);
assert(
  inputs.every(
    (name) =>
      !/cli\.js|node:|sharp|storeIdentity|publicStoreIdentity/.test(name),
  ),
);
assert(
  inputs.every(
    (name) =>
      name.startsWith("node_modules/image-dimensions/") ||
      name === "src/lib/prepareIdentityImage.ts" ||
      name === "tests/browser-identity-images/entry.ts",
  ),
);
await writeFile(path.join(output, "bundle.js"), js);
await writeFile(
  path.join(output, "metafile.json"),
  JSON.stringify(bundle.metafile, null, 2),
);
const cases = [];
async function fixture(
  name,
  bytes,
  expected = "accept",
  mime = "",
  dimensions = undefined,
) {
  await writeFile(path.join(output, name), bytes);
  cases.push({ name, bytes, expected, mime, dimensions, sha256: hash(bytes) });
}
const raster = (width = 32, height = 16) =>
  sharp({ create: { width, height, channels: 4, background: "#3478ae" } });
for (const size of [180, 192, 512])
  await fixture(
    `png-${size}.png`,
    await raster(size, size).png().toBuffer(),
    "accept",
    "",
    [size, size],
  );
await fixture(
  "png-og.png",
  await raster(1200, 630).png().toBuffer(),
  "accept",
  "image/jpeg",
  [1200, 630],
);
await fixture(
  "png-8192.png",
  await raster(8192, 1).png().toBuffer(),
  "accept",
  "",
  [8192, 1],
);
await fixture(
  "png-8193.png",
  await raster(8193, 1).png().toBuffer(),
  "IDENTITY_IMAGE_DIMENSIONS",
);
for (const orientation of [1, 6, 8])
  await fixture(
    `jpeg-exif-${orientation}.jpg`,
    await raster().jpeg().withMetadata({ orientation }).toBuffer(),
    "accept",
    "image/png",
    [32, 16],
  );
// Fixed reviewer bytes: no encoding is performed after adding marker fill.
const paddedJpeg = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj//8AAEQgAEAAgAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAH/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABYBAQEBAAAAAAAAAAAAAAAAAAAGCP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJ0AjmkQAH//2Q==",
  "base64",
);
assert.equal(paddedJpeg.length, 274);
assert.equal(
  hash(paddedJpeg),
  "31a4aa557fd7fe9f2986b18a4c2c1810b1bf91fdf10e8eff59a4a5ef30945b76",
);
const baselineJpeg = Buffer.concat([
  paddedJpeg.subarray(0, 140),
  paddedJpeg.subarray(141),
]);
const jpegRawHashes = new Map();
async function jpegVariant(name, bytes, reference) {
  const image = sharp(reference, {
    failOn: "warning",
    limitInputPixels: 8192 * 8192,
  });
  try {
    jpegRawHashes.set(name, hash(await image.raw().toBuffer()));
  } finally {
    image.destroy();
  }
  await fixture(name, bytes, "accept", "", [32, 16]);
}
await jpegVariant("jpeg-reviewer-fill-sof.jpg", paddedJpeg, baselineJpeg);
for (const count of [1, 4]) {
  const fill = Buffer.alloc(count, 255);
  // Known SOF0 at offset 140, first DQT at 2. APP15/COM payloads are opaque,
  // including embedded FF FF and a fake SOF header with misleading dimensions.
  const sof = Buffer.concat([
    baselineJpeg.subarray(0, 140),
    fill,
    baselineJpeg.subarray(140),
  ]);
  const app = Buffer.from([
    255, 239, 0, 13, 65, 255, 255, 192, 0, 8, 8, 0, 7, 0, 9,
  ]);
  const comment = Buffer.from([255, 254, 0, 4, 255, 255]);
  const bytes = Buffer.concat([
    sof.subarray(0, 2),
    fill,
    app,
    fill,
    comment,
    fill,
    sof.subarray(2),
  ]);
  await jpegVariant(
    `jpeg-fill-app-com-dqt-sof-${count}.jpg`,
    bytes,
    baselineJpeg,
  );
}
for (const orientation of [1, 6, 8]) {
  const original = await raster()
    .jpeg({ progressive: true })
    .withMetadata({ orientation })
    .toBuffer();
  const bytes = Buffer.concat([
    original.subarray(0, 2),
    Buffer.from([255, 255]),
    original.subarray(2),
  ]);
  await jpegVariant(
    `jpeg-progressive-fill-exif-${orientation}.jpg`,
    bytes,
    original,
  );
}
for (const [name, tail] of [
  ["length-zero", [255, 239, 0, 0]],
  ["length-one", [255, 239, 0, 1]],
  ["truncated-length", [255, 239, 0]],
  ["truncated-payload", [255, 239, 255, 255]],
  ["terminal-fill", [255, 255]],
  ["no-sof", [255, 239, 0, 2]],
  ["early-sos", [255, 218, 0, 2]],
  ["truncated-sof", [255, 192, 0, 17, 8, 0, 16, 0, 32, 3]],
]) {
  await fixture(
    `jpeg-invalid-${name}.jpg`,
    Buffer.from([255, 216, ...tail]),
    "IDENTITY_IMAGE_DIMENSIONS",
  );
}
await fixture(
  "webp-vp8.webp",
  await raster().webp().toBuffer(),
  "accept",
  "",
  [32, 16],
);
await fixture(
  "webp-vp8l.webp",
  await raster().webp({ lossless: true }).toBuffer(),
  "accept",
  "",
  [32, 16],
);
await fixture(
  "webp-vp8x.webp",
  await raster().webp().withMetadata().toBuffer(),
  "accept",
  "",
  [32, 16],
);

// Synthetic container construction, not an image parser: inner frame from Sharp.
function chunk(name, payload) {
  const result = Buffer.alloc(8 + payload.length + (payload.length % 2));
  result.write(name, 0, "ascii");
  result.writeUInt32LE(payload.length, 4);
  payload.copy(result, 8);
  return result;
}
const still = await raster().webp({ lossless: true }).toBuffer();
const vp8x = Buffer.alloc(10);
vp8x[0] = 2;
vp8x.writeUIntLE(31, 4, 3);
vp8x.writeUIntLE(15, 7, 3);
const frame = Buffer.alloc(16);
frame.writeUIntLE(31, 6, 3);
frame.writeUIntLE(15, 9, 3);
frame.writeUIntLE(100, 12, 3);
for (const frames of [1, 2]) {
  const payload = Buffer.concat([
    Buffer.from("WEBP"),
    chunk("VP8X", vp8x),
    chunk("ANIM", Buffer.alloc(6)),
    ...Array.from({ length: frames }, () =>
      chunk("ANMF", Buffer.concat([frame, still.subarray(12)])),
    ),
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF");
  header.writeUInt32LE(payload.length, 4);
  await fixture(
    `webp-animation-${frames}.webp`,
    Buffer.concat([header, payload]),
    frames === 1 ? "accept" : "IDENTITY_IMAGE_FORMAT",
    "",
    [32, 16],
  );
}
for (const format of ["png", "jpeg", "webp"]) {
  const image = raster();
  const bytes = await (format === "png"
    ? image.png()
    : format === "jpeg"
      ? image.jpeg()
      : image.webp()
  ).toBuffer();
  await fixture(
    `${format}-corrupt.${format}`,
    bytes.subarray(0, format === "png" ? 40 : 20),
    "reject",
  );
}
for (const [name, attributes] of [
  ["fixed", 'width="200" height="100"'],
  ["viewbox", 'viewBox="0 0 40 20"'],
  ["sizeless", ""],
  ["oversize", 'width="8193" height="1"'],
]) {
  await fixture(
    `svg-${name}.svg`,
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="40" height="20" fill="red"/></svg>`,
    ),
    name === "oversize" ? "IDENTITY_IMAGE_DIMENSIONS" : "accept",
  );
}
await fixture(
  "svg-invalid.svg",
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'),
  "IDENTITY_IMAGE_FORMAT",
);
// Multiple PNG representations; native decode chooses one, not all entries.
const representations = await Promise.all(
  [16, 32, 256].map((size) => raster(size, size).png().toBuffer()),
);
const table = Buffer.alloc(6 + 16 * representations.length);
table.writeUInt16LE(1, 2);
table.writeUInt16LE(representations.length, 4);
let offset = table.length;
representations.forEach((bytes, i) => {
  const entry = 6 + i * 16;
  const size = [16, 32, 0].at(i);
  table.writeUInt8(size, entry);
  table[entry + 1] = size;
  table.writeUInt16LE(1, entry + 4);
  table.writeUInt16LE(32, entry + 6);
  table.writeUInt32LE(bytes.length, entry + 8);
  table.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
});
await fixture("ico-multiple.ico", Buffer.concat([table, ...representations]));
await fixture(
  "ico-truncated.ico",
  table.subarray(0, table.length - 1),
  "IDENTITY_IMAGE_FORMAT",
);

let traps = 0;
const requests = [];
const violations = [];
const consoleLog = [];
const server = http.createServer((request, response) => {
  requests.push(request.url);
  if (request.url === "/") {
    response.setHeader("content-type", "text/html");
    response.end(
      '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Identity images isolated acceptance</title><h1>Local image preparation</h1><pre id="results"></pre><script src="/bundle.js"></script>',
    );
  } else if (request.url === "/bundle.js") {
    response.setHeader("content-type", "application/javascript");
    response.end(js);
  } else {
    if (request.url?.startsWith("/trap")) traps++;
    else violations.push(`server:${request.url}`);
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await fixture(
  "svg-inert.svg",
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><script>window.identityScriptExecuted=true;fetch('${origin}/trap-script')</script><image href="${origin}/trap-image" width="20" height="20"/><rect width="10" height="10" fill="blue"/></svg>`,
  ),
);
await fixture(
  "svg-external-entity.svg",
  Buffer.from(
    `<!DOCTYPE svg [<!ENTITY x SYSTEM "${origin}/trap-entity">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>`,
  ),
  "accept",
);
let browser;
const results = [];
let failure;
const previews = cases
  .filter((item) =>
    [
      "png-192.png",
      "jpeg-exif-6.jpg",
      "jpeg-reviewer-fill-sof.jpg",
      "jpeg-fill-app-com-dqt-sof-4.jpg",
      "jpeg-progressive-fill-exif-6.jpg",
      "webp-animation-1.webp",
      "svg-fixed.svg",
      "ico-multiple.ico",
    ].includes(item.name),
  )
  .map((item) => {
    const mime = item.name.endsWith(".svg")
      ? "image/svg+xml"
      : item.name.endsWith(".ico")
        ? "image/vnd.microsoft.icon"
        : item.name.endsWith(".jpg")
          ? "image/jpeg"
          : item.name.endsWith(".webp")
            ? "image/webp"
            : "image/png";
    return {
      name: item.name,
      src: `data:${mime};base64,${item.bytes.toString("base64")}`,
    };
  });
const previewUrls = new Set(previews.map(({ src }) => src));
try {
  browser = await puppeteer.launch({
    headless: true,
    executablePath: await puppeteer.executablePath(),
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
    ],
  });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (
      url === `${origin}/` ||
      url === `${origin}/bundle.js` ||
      url.startsWith(`blob:${origin}/`) ||
      previewUrls.has(url) ||
      url === "data:,"
    )
      void request.continue();
    else {
      violations.push(url);
      if (url.startsWith(`${origin}/trap`)) traps++;
      void request.abort();
    }
  });
  page.on("console", (message) =>
    consoleLog.push({ type: message.type(), text: message.text() }),
  );
  page.on("pageerror", (error) =>
    violations.push(`pageerror:${error.message}`),
  );
  await page.goto(origin, { waitUntil: "networkidle0" });
  for (const item of cases) {
    const actual = await page.evaluate(
      (data, mime) => window.identityImages(data, mime),
      [...item.bytes],
      item.mime,
    );
    let a4;
    if (/^(png|jpeg|webp)/.test(item.name)) {
      const image = sharp(item.bytes, {
        failOn: "warning",
        limitInputPixels: 8192 * 8192,
      });
      try {
        const meta = await image.metadata();
        if (
          !meta.width ||
          !meta.height ||
          meta.width > 8192 ||
          meta.height > 8192 ||
          (meta.pages ?? 1) !== 1
        )
          throw Error("A4_METADATA");
        const raw = await image.raw().toBuffer();
        a4 = {
          rawHash: hash(raw),
          rawBytes: raw.length,
          accepted: true,
          format: meta.format,
          width: meta.width,
          height: meta.height,
          pages: meta.pages ?? 1,
          orientation: meta.orientation,
        };
      } catch {
        a4 = { accepted: false };
      } finally {
        image.destroy();
      }
    }
    results.push({
      name: item.name,
      sourceHash: item.sha256,
      referenceRawHash: jpegRawHashes.get(item.name),
      sourceBytes: item.bytes.length,
      expected: item.expected,
      actual,
      a4,
    });
    assert.equal(actual.active, 0, item.name);
    assert.equal(actual.created, actual.revoked, item.name);
    if (item.expected === "accept") {
      assert.equal(actual.ok, true, `${item.name}: ${actual.error}`);
      assert.equal(actual.returnedHash, item.sha256, item.name);
      assert.equal(actual.asset.sha256, item.sha256, item.name);
      assert.equal(actual.returnedSize, item.bytes.length, item.name);
      assert.equal(actual.returnedType, actual.asset.media_type, item.name);
      assert.equal(actual.frozen, true, item.name);
      assert.equal(actual.returnedBytesEqual, true, item.name);
      if (item.dimensions)
        assert.deepEqual(
          [actual.asset.width, actual.asset.height],
          item.dimensions,
          item.name,
        );
      else {
        assert.equal(actual.asset.width, undefined);
        assert.equal(actual.asset.height, undefined);
      }
      if (a4) {
        assert.equal(
          a4.accepted,
          true,
          `ROOT_DECISION_REQUIRED: A4 diverges ${item.name}`,
        );
        assert.deepEqual(
          [actual.asset.width, actual.asset.height],
          [a4.width, a4.height],
          item.name,
        );
        assert.equal(actual.asset.media_type, `image/${a4.format}`, item.name);
        if (jpegRawHashes.has(item.name))
          assert.equal(a4.rawHash, jpegRawHashes.get(item.name), item.name);
      }
    } else {
      assert.equal(actual.ok, false, item.name);
      if (item.expected !== "reject")
        assert.equal(actual.error, item.expected, item.name);
    }
  }
  const cancellation = await page.evaluate(
    (data) => window.identityImages(data, "", true),
    [...cases[0].bytes],
  );
  results.push({ name: "cancel-after-native-decode", actual: cancellation });
  assert.equal(cancellation.error, "IDENTITY_IMAGE_CANCELED");
  assert.equal(cancellation.decoded, true);
  assert.equal(cancellation.created, 1);
  assert.equal(cancellation.revoked, 1);
  assert.equal(cancellation.active, 0);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
  assert.equal(
    await page.evaluate(() => window.identityScriptExecuted),
    undefined,
  );
  await page.evaluate(async (items) => {
    const gallery = document.createElement("div");
    gallery.style.cssText =
      "display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;font:14px sans-serif";
    for (const item of items) {
      const figure = document.createElement("figure");
      figure.style.cssText = "margin:8px;width:200px";
      const image = new Image();
      image.src = item.src;
      image.alt = item.name;
      image.style.cssText =
        "max-width:200px;max-height:200px;border:1px solid #aaa";
      const label = document.createElement("figcaption");
      label.textContent = item.name;
      await image.decode();
      figure.append(image, label);
      gallery.append(figure);
    }
    document.body.prepend(gallery);
  }, previews);
  await page.screenshot({
    path: path.join(output, "representative-images.png"),
    fullPage: true,
  });
  assert.equal(traps, 0);
  assert.deepEqual(violations, []);
  await page.evaluate(
    (data) => {
      document.querySelector("#results").textContent = JSON.stringify(
        data,
        null,
        2,
      );
    },
    results.map(({ name, actual }) => ({
      name,
      ok: actual.ok,
      error: actual.error,
      naturalSize: actual.naturalSize,
    })),
  );
  await page.screenshot({
    path: path.join(output, "results.png"),
    fullPage: true,
  });
} catch (error) {
  failure = error;
} finally {
  const sources = new Map();
  for (const name of [
    "src/lib/prepareIdentityImage.ts",
    "tests/front/prepare-identity-image.test.ts",
    "tests/browser-identity-images/entry.ts",
    "tests/browser-identity-images/run.mjs",
    "package.json",
    "package-lock.json",
    "scripts/prepareIdentity.ts",
  ])
    sources.set(name, hash(await readFile(path.join(root, name))));
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        passed: !failure,
        failure: failure?.message,
        chromium: browser ? await browser.version() : null,
        sharp: sharp.versions,
        bundleBytes: js.length,
        bundleHash: hash(js),
        inputs,
        sources: Object.fromEntries(sources),
        cases: results,
        traps,
        violations,
        requests,
        console: consoleLog,
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  JSON.stringify(
    {
      passed: !failure,
      cases: results.length,
      expectedCases: cases.length + 1,
      bundleBytes: js.length,
      traps,
      violations,
      output,
    },
    null,
    2,
  ),
);
if (failure) throw failure;
