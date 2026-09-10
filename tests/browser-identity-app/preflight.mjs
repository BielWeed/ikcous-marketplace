/* eslint-disable security/detect-non-literal-fs-filename -- Only fixed prior evidence paths and own TEMP profiles are used. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";
import { serviceOrigin } from "./contracts.mjs";
import { control, write } from "./evidence.mjs";
import { certificate, transport } from "./transport.mjs";

export async function launch(bench, pin, profiles, label) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "a6cp-"));
  const entry = { label, path: profile, closed: false };
  profiles.push(entry);
  const browser = await puppeteer.launch({
    executablePath: await puppeteer.executablePath(),
    headless: false,
    userDataDir: profile,
    args: [
      `--proxy-server=${bench.proxy}`,
      "--proxy-bypass-list=<-loopback>",
      "--disable-quic",
      "--no-first-run",
      "--no-default-browser-check",
      ...(pin ? [`--ignore-certificate-errors-spki-list=${pin}`] : []),
    ],
  });
  browser.once("disconnected", () => {
    entry.closed = true;
  });
  return browser;
}
export async function preflight(directory) {
  const original = path.join(
    control,
    "tarefa-A6b-2026-09-09T16-01-54.539Z-e29da781-ebc8-407c-8da6-7e10e67a610d",
  );
  const artifact = {
    directory: path.join(original, "ikcous"),
    snapshot: JSON.parse(
      await fs.readFile(path.join(original, "ikcous-snapshot.json")),
    ),
  };
  const cert = await certificate();
  const bench = await transport(cert, artifact);
  const profiles = [];
  const outcomes = [];
  try {
    for (const [label, pin, expected] of [
      ["correct", cert.pin, true],
      ["missing", null, false],
      ["incorrect", randomBytes(32).toString("base64"), false],
    ]) {
      let browser;
      try {
        browser = await launch(bench, pin, profiles, label);
        const page = await browser.newPage();
        let succeeded = false;
        let failure = null;
        try {
          const response = await page.goto(
            artifact.snapshot.identity.urls.header,
            { waitUntil: "load", timeout: 20000 },
          );
          succeeded = response?.status() === 200;
        } catch (error) {
          failure = error.message;
        }
        outcomes.push({ label, succeeded, failure });
        assert.equal(succeeded, expected, `SPKI_PREFLIGHT_${label}`);
        if (!expected)
          assert.match(
            failure,
            /ERR_CERT_AUTHORITY_INVALID/,
            "TLS_FAILURE_REASON",
          );
        if (expected) {
          const unknown = await page.goto(`${serviceOrigin}/unknown`, {
            waitUntil: "load",
          });
          assert.equal(unknown.status(), 403, "UNKNOWN_EXTERNAL_REFUSED");
          const missing = await page.goto(`${bench.origin}/missing-local.js`, {
            waitUntil: "load",
          });
          assert.equal(missing.status(), 404, "MISSING_LOCAL_REFUSED");
          const duplicate = await page.goto(
            `${serviceOrigin}/rest/v1/v_store_config?select=*&select=*`,
            { waitUntil: "load" },
          );
          assert.equal(duplicate.status(), 403, "DUPLICATE_QUERY_REFUSED");
          let escaped = false;
          try {
            await page.goto("https://example.invalid/", { timeout: 10000 });
            escaped = true;
          } catch {}
          assert(!escaped, "EXTERNAL_DESTINATION_REFUSED");
        }
      } finally {
        if (browser?.connected) await browser.close();
      }
    }
    console.log(
      "A6C_PREFLIGHT_PASS correct pin succeeds; absent/wrong fail; unknown routes/destination refused; no app executed",
    );
  } finally {
    await bench.close();
    await write(directory, "preflight.json", {
      outcomes,
      profiles,
      certificate: {
        directory: cert.directory,
        fingerprint: cert.fingerprint,
        pin: cert.pin,
      },
      events: bench.events,
    });
  }
  return cert;
}
