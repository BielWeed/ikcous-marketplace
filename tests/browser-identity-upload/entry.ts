import { prepareIdentityImage } from "../../src/lib/prepareIdentityImage";
import { uploadIdentityImage } from "../../src/lib/uploadIdentityImage";
import type { IdentityImageUploadProgress } from "../../src/lib/uploadIdentityImage";

interface RunOptions {
  label: string;
  large?: boolean;
  userId?: string;
  projectRef?: string;
  cancelChunk?: boolean;
  authChange?: boolean;
  abortAuth?: boolean;
  probe?: string | null;
}
async function run(options: RunOptions) {
  const nativeFetch = window.fetch.bind(window);
  const fixture = await nativeFetch(
    options.large ? "/fixture-big" : "/fixture-small",
  );
  const controller = new AbortController();
  const prepared = await prepareIdentityImage(await fixture.blob(), {
    signal: controller.signal,
  });
  const userId = options.userId ?? "u1";
  const projectRef = options.projectRef ?? "aaaaaaaaaaaaaaaaaaaa";
  const origin = `https://${projectRef}.supabase.co`;
  let current = true;
  const progress: IdentityImageUploadProgress[] = [];
  let authCalls = 0;
  const probeActions: string[] = [];
  const setItem = Storage.prototype.setItem;
  const removeItem = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "tusSupport") probeActions.push("set");
    setItem.call(this, key, value);
  };
  Storage.prototype.removeItem = function (key) {
    if (key === "tusSupport") probeActions.push("remove");
    removeItem.call(this, key);
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const expected = String(input);
    const url = new URL(expected);
    if (
      ![origin, `https://${projectRef}.storage.supabase.co`].includes(
        url.origin,
      )
    )
      throw new Error("harness origin");
    if (init?.redirect !== "error" || init.credentials !== "omit")
      throw new Error("harness request policy");
    const response = await nativeFetch(
      `/wire/${options.label}${url.pathname}`,
      init,
    );
    // Loopback is a test-only transport. The production validator still receives
    // the exact fictitious Supabase URL it requested, never an allowed localhost.
    Object.defineProperty(response, "url", { value: expected });
    return response;
  };
  try {
    const result = await uploadIdentityImage(prepared, {
      supabaseUrl: origin,
      userId,
      signal: controller.signal,
      isCurrent: () => current,
      authorize: async () => {
        authCalls++;
        if (options.authChange) current = false;
        if (options.abortAuth) controller.abort();
        return { userId, accessToken: "only-synthetic-token" };
      },
      fetchImpl,
      timeoutMs: 20000,
      onProgress: (value) => {
        progress.push(value);
        document.body.textContent = `${value.stage}: ${value.uploadedBytes}/${value.totalBytes}`;
        if (
          options.cancelChunk &&
          value.stage === "uploading" &&
          value.uploadedBytes > 0
        )
          controller.abort();
      },
    });
    return {
      code: "OK",
      asset: result.asset,
      url: result.url,
      progress,
      authCalls,
      probeActions,
      probe: localStorage.getItem("tusSupport"),
      keys: Object.keys(localStorage),
    };
  } catch (error) {
    return {
      code: error instanceof Error ? error.message : "UNKNOWN",
      asset: prepared.asset,
      progress,
      authCalls,
      probeActions,
      probe: localStorage.getItem("tusSupport"),
      keys: Object.keys(localStorage),
    };
  } finally {
    Storage.prototype.setItem = setItem;
    Storage.prototype.removeItem = removeItem;
  }
}
Object.assign(window, { identityUploadHarness: { run } });
