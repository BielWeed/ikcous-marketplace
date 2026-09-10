import assert from "node:assert/strict";
import { artifactCallsites } from "./callsites.mjs";
import {
  assertObservations,
  assertRevision,
  serviceOrigin,
  serviceRoute,
} from "./contracts.mjs";
import { files, write } from "./evidence.mjs";
import {
  capture,
  observe,
  readCache,
  safe,
  verifyCache,
  view,
  waitOpen,
} from "./observe.mjs";
import { launch } from "./preflight.mjs";
import { transport } from "./transport.mjs";

export async function journey(directory, store, baseline, update, cert) {
  const bench = await transport(cert, baseline);
  const events = [];
  const profiles = [];
  const result = {
    store,
    status: "INCOMPLETE",
    steps: [],
    profiles,
    font: "Google Fonts refused; system fallback; Inter fidelity excluded",
  };
  let browser;
  let observer;
  let page;
  let phase = "initial";
  const contract = {
    origin: bench.origin,
    logos: new Set([
      baseline.snapshot.identity.urls.header,
      update.snapshot.identity.urls.header,
    ]),
    localPaths: new Set(),
    offlineCuts: [],
  };
  result.offlineCuts = contract.offlineCuts;
  const check = async () => {
    await observer?.finish();
    result.classifications = assertObservations(events, bench.events, contract);
  };
  const fail = (error) => {
    result.status = "FAIL";
    result.failedPhase ??= phase;
    result.error = [result.error, safe(error.stack ?? error.message)]
      .filter(Boolean)
      .join("\n");
  };
  let offlineIndex;
  let currentCut;
  const proofs = new Map();
  const cut = async (artifact) => {
    const beforeCache = await readCache(page);
    await observer.finish();
    offlineIndex = bench.events.length;
    currentCut = {
      phase,
      proof: proofs.get(artifact),
      beforeCache,
      eventStart: events.length,
      transportStart: offlineIndex,
    };
    contract.offlineCuts.push(currentCut);
    observer.setOffline(true);
    bench.offline(true);
    await observer.session.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
  };
  const checkCut = async () => {
    // biome-ignore format: the probe mock in journey.spec.mjs matches the function
    // source text for "then(() => false"; reflowing this call breaks that match.
    assert(
      await page.evaluate(() =>
        fetch("/version.json", { cache: "no-store" }).then(() => false, () => true)),
      "OFFLINE_PROBE_BLOCKED",
    );
    await check();
    const interval = bench.events.slice(offlineIndex);
    assert(
      interval.some((e) => e.type === "network-switch" && e.offline),
      "OFFLINE_CUT_MISSING",
    );
    assert(
      !interval.some((e) => e.type === "response"),
      "OFFLINE_NETWORK_RESPONSE",
    );
  };
  const step = (name) => {
    phase = name;
    bench.setPhase(`${store}-${name}`);
    result.steps.push({ name, at: Date.now() });
    console.log(`A6C_STEP ${store} ${name}`);
  };
  try {
    for (const artifact of [baseline, update]) {
      for (const filename of await files(artifact.directory))
        contract.localPaths.add(filename);
      proofs.set(artifact, await artifactCallsites(artifact, bench.origin));
    }
    browser = await launch(bench, cert.pin, profiles, `${store}-acceptance`);
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    observer = await observe(page, browser, events);
    step("baseline-first-navigation");
    await page.goto(bench.origin, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await write(
      directory,
      `${store}-initial.png`,
      await page.screenshot({ fullPage: true }),
    );
    await write(directory, `${store}-initial-view.json`, await view(page));
    await waitOpen(page);
    await capture(directory, `${store}-baseline-desktop`, page, baseline, true);
    await page.setViewport({ width: 390, height: 844 });
    await capture(directory, `${store}-baseline-mobile`, page, baseline, true);
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, {
      timeout: 30000,
    });
    result.controlObservedAt = Date.now();
    await verifyCache(
      page,
      directory,
      `${store}-baseline-installed`,
      baseline,
      bench.origin,
    );
    await check();
    for (const kind of ["config", "products", "categories", "banners"])
      assert(
        bench.events.some(
          (e) =>
            e.type === "response" &&
            e.url.startsWith(serviceOrigin) &&
            serviceRoute(e.url.slice(serviceOrigin.length)) === kind,
        ),
        `PUBLIC_GET_MISSING ${kind}`,
      );
    assert(
      events.some(
        (e) =>
          e.kind === "response" &&
          e.url === baseline.snapshot.identity.urls.header &&
          e.status === 200 &&
          e.sha256 === baseline.snapshot.identity.assets.header.sha256,
      ),
      "REMOTE_LOGO_BYTES_MISSING",
    );

    step("baseline-offline-first-reload");
    await cut(baseline);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await waitOpen(page);
    currentCut.recovery = await capture(
      directory,
      `${store}-baseline-offline`,
      page,
      baseline,
      false,
    );
    currentCut.afterCache = await verifyCache(
      page,
      directory,
      `${store}-baseline-offline`,
      baseline,
      bench.origin,
    );
    await checkCut();
    await observer.finish();
    currentCut.eventEnd = events.length;
    currentCut.transportEnd = bench.events.length;
    result.classifications = assertObservations(events, bench.events, contract);
    step("update-published-locally");
    observer.setOffline(false);
    bench.offline(false);
    await observer.session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    bench.select(update);
    const blank = await browser.newPage();
    await blank.bringToFront();
    await page.bringToFront();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some((button) =>
          button.textContent.includes("Atualizar Agora"),
        ),
      { timeout: 45000 },
    );
    await page.waitForFunction(
      async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
      { timeout: 30000 },
    );
    await write(
      directory,
      `${store}-update-waiting.png`,
      await page.screenshot({ fullPage: true }),
    );
    await write(
      directory,
      `${store}-update-waiting-state.json`,
      await page.evaluate(async () => ({
        text: document.body.innerText,
        waiting: (await navigator.serviceWorker.getRegistration())?.waiting
          ?.state,
      })),
    );
    assert(
      await page.evaluate(() =>
        document.body.innerText.includes("Nova Versão Disponível"),
      ),
      "REAL_UPDATE_NOTICE",
    );
    await check();
    step("real-update-button");
    const button = await page.$("::-p-text(Atualizar Agora)");
    assert(button, "REAL_UPDATE_BUTTON");
    const navigation = page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await button.click();
    await navigation;
    await waitOpen(page);
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, {
      timeout: 30000,
    });
    await capture(directory, `${store}-updated-mobile`, page, update, true);
    await page.setViewport({ width: 1280, height: 900 });
    await capture(directory, `${store}-updated-desktop`, page, update, true);
    const cache = await verifyCache(
      page,
      directory,
      `${store}-updated`,
      update,
      bench.origin,
    );
    assert.throws(
      () =>
        assertRevision(
          update.snapshot.identityRevision,
          baseline.snapshot.identityRevision,
        ),
      /REVISION/,
      "OLD_REVISION_COUNTERPROOF",
    );
    const marker = await page.evaluate(() =>
      fetch("/version.json", { cache: "no-store" }).then((r) => r.json()),
    );
    assertRevision(marker.identityRevision, update.snapshot.identityRevision);
    assert(
      cache.some((e) => e.cache === `app-cache-${marker.version}`),
      "SW_MARKER_COHERENT",
    );
    await check();
    step("update-offline-reload");
    await cut(update);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await waitOpen(page);
    currentCut.recovery = await capture(
      directory,
      `${store}-updated-offline`,
      page,
      update,
      false,
    );
    currentCut.afterCache = await verifyCache(
      page,
      directory,
      `${store}-updated-offline`,
      update,
      bench.origin,
    );
    await checkCut();
  } catch (error) {
    fail(error);
    console.log(`A6C_JOURNEY_FAIL ${store} ${phase} ${error.message}`);
    if (page) {
      await write(
        directory,
        `${store}-failure.png`,
        await page.screenshot({ fullPage: true }),
      ).catch(() => {});
      await write(
        directory,
        `${store}-failure-view.json`,
        await view(page),
      ).catch(() => {});
    }
  } finally {
    // No PASS until Chrome shutdown, observer drainage and transport closure all succeed.
    for (const close of [
      async () => {
        await observer?.finish();
      },
      async () => {
        if (browser?.connected) await browser.close();
      },
      async () => {
        await observer?.close();
      },
      async () => {
        await bench.close();
      },
    ]) {
      try {
        await close();
      } catch (error) {
        fail(error);
      }
    }
    try {
      result.classifications = assertObservations(
        events,
        bench.events,
        contract,
      );
      if (phase === "update-offline-reload" && offlineIndex !== undefined)
        assert(
          !bench.events.slice(offlineIndex).some((e) => e.type === "response"),
          "OFFLINE_NETWORK_RESPONSE",
        );
    } catch (error) {
      fail(error);
    }
    if (result.status !== "FAIL") result.status = "PASS";
    await write(directory, `${store}-browser-events.json`, events);
    await write(directory, `${store}-transport.json`, bench.events);
    await write(directory, `${store}-result.json`, result);
  }
  console.log(`A6C_JOURNEY_${result.status} ${store}`);
  return result;
}
