/* eslint-disable security/detect-non-literal-fs-filename -- Fixed prior evidence artifact and exclusive own test directory. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { publicKey, serviceOrigin } from "./contracts.mjs";
import { control, write } from "./evidence.mjs";
import { launch } from "./preflight.mjs";
import { certificate, transport } from "./transport.mjs";

test("CORS accepts SDK public schema and refuses arbitrary schema", async () => {
  const prior = path.join(
    control,
    "tarefa-A6b-2026-09-09T16-01-54.539Z-e29da781-ebc8-407c-8da6-7e10e67a610d",
  );
  const artifact = {
    directory: path.join(prior, "ikcous"),
    snapshot: JSON.parse(
      await fs.readFile(path.join(prior, "ikcous-snapshot.json")),
    ),
  };
  const directory = path.join(
    control,
    `tarefa-A6c6-cors-${Date.now()}-${randomUUID()}`,
  );
  await fs.mkdir(directory);
  const cert = await certificate();
  const bench = await transport(cert, artifact);
  const profiles = [];
  const preflights = [];
  let browser;
  try {
    browser = await launch(bench, cert.pin, profiles, "cors-contract");
    const page = await browser.newPage();
    const session = await page.createCDPSession();
    await session.send("Network.enable");
    session.on("Network.requestWillBeSent", ({ request }) => {
      if (request.method !== "OPTIONS") return;
      const header = Object.entries(request.headers).find(
        ([name]) => name.toLowerCase() === "access-control-request-headers",
      );
      preflights.push({
        url: request.url,
        requestedHeaders: (header?.[1] ?? "")
          .split(",")
          .map((name) => name.trim().toLowerCase())
          .filter(Boolean),
      });
    });
    // Plain text artifact, never executes an app or writes caches.
    await page.goto(`${bench.origin}/robots.txt`);
    const results = await page.evaluate(
      async ({ serviceOrigin, publicKey }) => {
        const outcomes = [];
        const cases = [
          { label: "public" },
          { label: "retry-public", extra: { "X-Retry-Count": "1" } },
          { label: "retry-again", extra: { "X-Retry-Count": "2" } },
          {
            label: "private",
            profile: "private",
            extra: { "X-Retry-Count": "1" },
          },
          { label: "unknown-header", extra: { "X-Unexpected-Header": "1" } },
          { label: "method", method: "POST" },
          { label: "route", route: "/rest/v1/unknown?select=*" },
          { label: "query", route: "/rest/v1/v_store_config?select=*&extra=1" },
        ];
        for (const item of cases) {
          const headers = {
            apikey: publicKey,
            Authorization: `Bearer ${publicKey}`,
            "Accept-Profile": item.profile ?? "public",
            Accept: "application/vnd.pgrst.object+json",
            ...item.extra,
          };
          const outcome = {
            label: item.label,
            requestedHeaderNames: Object.keys(headers)
              .map((name) => name.toLowerCase())
              .sort(),
          };
          try {
            const response = await fetch(
              serviceOrigin +
                (item.route ?? "/rest/v1/v_store_config?select=*"),
              { method: item.method ?? "GET", headers },
            );
            outcomes.push({
              ...outcome,
              ok: response.ok,
              status: response.status,
            });
          } catch {
            outcomes.push({ ...outcome, ok: false });
          }
        }
        return outcomes;
      },
      { serviceOrigin, publicKey },
    );
    // A data document has opaque Origin:null, distinct from the allowed app origin.
    await page.goto("data:text/html,<title>Foreign neutral origin</title>");
    const foreign = await page.evaluate(async (serviceOrigin) => {
      try {
        const response = await fetch(
          `${serviceOrigin}/rest/v1/v_store_config?select=*`,
        );
        return { label: "origin", ok: response.ok, status: response.status };
      } catch {
        return { label: "origin", ok: false };
      }
    }, serviceOrigin);
    results.push(foreign);
    await write(directory, "outcomes.json", results);
    assert.equal(results[0].ok, true, "PUBLIC_SCHEMA_CORS");
    assert.equal(results[1].ok, true, "PUBLIC_RETRY_CORS");
    assert.equal(results[2].ok, true, "PUBLIC_RETRY_AGAIN_CORS");
    for (const outcome of results.slice(3))
      assert.equal(outcome.ok, false, `REFUSED_${outcome.label}`);
    assert(
      preflights.some((item) =>
        item.requestedHeaders.includes("x-retry-count"),
      ),
      "RETRY_PREFLIGHT_OBSERVED",
    );
    for (const reason of [
      "public-schema",
      "cors-preflight",
      "unknown-service",
      "cors-origin",
    ])
      assert(
        bench.events.some(
          (item) => item.type === "deny" && item.reason === reason,
        ),
        `DENIAL_REASON_${reason}`,
      );
    const headerDenial = bench.events.find(
      (item) =>
        item.type === "cors-preflight-rejected" && item.rejection === "headers",
    );
    assert.deepEqual(
      headerDenial?.rejectedHeaders,
      ["x-unexpected-header"],
      "UNKNOWN_HEADER_DIAGNOSTIC",
    );
    assert(
      bench.events.some(
        (item) =>
          item.type === "cors-preflight-rejected" &&
          item.rejection === "method",
      ),
      "POST_PREFLIGHT_REFUSED",
    );
    assert(
      !JSON.stringify({ preflights, events: bench.events }).includes(publicKey),
      "NO_HEADER_VALUES_RECORDED",
    );
  } finally {
    try {
      if (browser?.connected) await browser.close();
    } finally {
      await bench.close();
      await write(directory, "transport.json", bench.events);
      await write(directory, "profiles.json", profiles);
      await write(directory, "preflights.json", preflights);
      console.log(`A6C_CORS_EVIDENCE ${directory}`);
    }
  }
});
