/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- Physical owned evidence root, closed store/phase keys and all artifact hashes verified. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  control,
  digests,
  git,
  physical,
  sourceDigests,
  write,
} from "./evidence.mjs";
import { journey } from "./journey.mjs";
import { preflight } from "./preflight.mjs";

assert.equal(process.argv.length, 3, "ONE_FROZEN_EVIDENCE_DIRECTORY");
const previous = path.resolve(process.argv[2]);
await physical(previous);
assert.equal(
  path.dirname(previous),
  path.resolve(control),
  "OWNED_CONTROL_DIRECTORY",
);
assert(path.basename(previous).startsWith("tarefa-A6c-"), "A6C_ARTIFACTS_ONLY");
const directory = path.join(
  control,
  `tarefa-A6c-replay-${Date.now()}-${randomUUID()}`,
);
await fs.mkdir(directory);
console.log(`A6C_REPLAY_EVIDENCE ${directory}`);
const before = await sourceDigests();
await write(directory, "sources-before.json", before);
const originalSources = JSON.parse(
  await fs.readFile(path.join(previous, "sources-before.json")),
);
const productOnly = (entries) =>
  entries.filter(
    (entry) => !entry.path.startsWith("tests/browser-identity-app/"),
  );
assert.deepEqual(
  productOnly(before),
  productOnly(originalSources),
  "FROZEN_PRODUCT_SOURCES",
);
const artifacts = {};
for (const store of ["ikcous", "savy"])
  for (const phase of ["baseline", "update"]) {
    const label = `${store}-${phase}`;
    const artifactDirectory = path.join(previous, label);
    const hashes = JSON.parse(
      await fs.readFile(path.join(previous, `${label}-hashes.json`)),
    );
    assert.deepEqual(
      await digests(artifactDirectory),
      hashes,
      "FROZEN_ARTIFACT_BYTES",
    );
    artifacts[label] = {
      directory: artifactDirectory,
      snapshot: JSON.parse(
        await fs.readFile(path.join(previous, `${label}-snapshot.json`)),
      ),
      precache: JSON.parse(
        await fs.readFile(path.join(previous, `${label}-precache.json`)),
      ),
    };
  }
await write(directory, "replay.json", {
  previous,
  codeSha: git(["rev-parse", "HEAD"]),
  mode: "reuse-four-byte-verified-artifacts; new-browser-profiles; no build",
  changedSourceScope: "tests/browser-identity-app only",
  note: "CORS accepts Accept-Profile only public; private schema proven refused",
});
try {
  const cert = await preflight(directory);
  const results = [];
  for (const store of ["ikcous", "savy"])
    results.push(
      await journey(
        directory,
        store,
        artifacts[`${store}-baseline`],
        artifacts[`${store}-update`],
        cert,
      ),
    );
  await write(directory, "results.json", results);
  assert.deepEqual(await sourceDigests(), before, "SOURCES_CHANGED");
  await write(directory, "sources-after.json", await sourceDigests());
  assert(
    results.every((result) => result.status === "PASS"),
    "A6C_NOT_ACCEPTED",
  );
} catch (error) {
  await write(directory, "failure.json", {
    message: error.message,
    stack: error.stack,
  });
  console.error(error.message);
  process.exitCode = 1;
}
