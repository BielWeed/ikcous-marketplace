const fs = require("node:fs");
const path = require("node:path");

const mode = process.env.IKCOUS_IDENTITY_MODE ?? "database";
if (!["database", "fixture"].includes(mode)) throw new Error("IDENTITY_MODE");
const output = mode === "fixture" ? "dist-test" : "dist";
// Measure only a completed delivery of the explicitly selected source.
const version = JSON.parse(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Output comes only from the closed database/fixture mode selection above.
  fs.readFileSync(path.join(__dirname, output, "version.json"), "utf8"),
);
if (version.source !== mode || version.promotable !== (mode === "database"))
  throw new Error("IDENTITY_OUTPUT: fonte do artefato diverge do modo");

module.exports = [
  { path: `${output}/assets/*.js`, limit: "800 kB" },
  { path: `${output}/assets/*.css`, limit: "100 kB", webpack: false },
];
