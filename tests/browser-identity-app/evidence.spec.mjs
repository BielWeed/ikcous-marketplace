/* eslint-disable security/detect-non-literal-fs-filename -- Own newly created TEMP test directory and fixed capture name. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { write } from "./evidence.mjs";

test("Puppeteer Uint8Array bytes stay binary and an existing capture is never overwritten", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "a6ce-"));
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
  await write(directory, "capture.png", bytes);
  assert.deepEqual(
    await fs.readFile(path.join(directory, "capture.png")),
    Buffer.from(bytes),
    "PNG_BYTES_PRESERVED",
  );
  await assert.rejects(write(directory, "capture.png", bytes), {
    code: "EEXIST",
  });
  console.log(`A6C_BINARY_EVIDENCE ${directory}`);
});
