/* eslint-disable security/detect-non-literal-fs-filename -- Fixed control and kit roots, UUID evidence directory and exclusive writes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildAll } from "./build.mjs";
import {
  approvedHash,
  control,
  git,
  hash,
  kit,
  root,
  sourceDigests,
  write,
} from "./evidence.mjs";
import { journey } from "./journey.mjs";
import { preflight } from "./preflight.mjs";

assert.equal(process.argv.length, 2, "NO_ARGUMENTS");
const directory = path.join(
  control,
  `tarefa-A6c-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`,
);
await fs.mkdir(directory);
console.log(`A6C_EVIDENCE ${directory}`);
const before = await sourceDigests();
await write(directory, "sources-before.json", before);
const codeSha = git(["rev-parse", "HEAD"]);
await write(directory, "run.json", {
  codeSha,
  root,
  approvedHash,
  scope: "real-app-and-sw-synthetic-external-services",
  promotable: false,
  mutation: "only two public fictitious defines, no env files or product edits",
  offline:
    "all loopback sockets closed and new connections refused; no cache insertion by automation",
  update:
    "real button property alias resolves to handleUpdate; no nuclear-purge expectation",
  artifacts: "four sequential real fixture builds",
});
try {
  assert.equal(
    hash(await fs.readFile(path.join(kit, "manifesto.json"))),
    approvedHash,
  );
  const cert = await preflight(directory);
  const artifacts = await buildAll(directory, codeSha);
  await write(directory, "builds-frozen.json", await sourceDigests());
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
  assert.deepEqual(await sourceDigests(), before, "SOURCES_CHANGED");
  await write(directory, "sources-after.json", await sourceDigests());
  await write(directory, "results.json", results);
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
