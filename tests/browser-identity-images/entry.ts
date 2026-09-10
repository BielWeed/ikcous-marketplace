import { prepareIdentityImage } from "../../src/lib/prepareIdentityImage";

const nativeDecode = HTMLImageElement.prototype.decode;
const createUrl = URL.createObjectURL.bind(URL);
const revokeUrl = URL.revokeObjectURL.bind(URL);
const activeUrls = new Set<string>();
let created = 0;
let revoked = 0;
URL.createObjectURL = (blob) => {
  const url = createUrl(blob);
  activeUrls.add(url);
  created++;
  return url;
};
URL.revokeObjectURL = (url) => {
  if (!activeUrls.delete(url)) throw Error("URL_REVOKED_TWICE");
  revoked++;
  revokeUrl(url);
};
// This independent entry has no app, configuration, network client or live SVG.
const harness = async (data: number[], mime: string, cancel = false) => {
  const controller = new AbortController();
  const before = { created, revoked };
  let release: (() => void) | undefined;
  let naturalSize: number[] | undefined;
  let decoded = false;
  HTMLImageElement.prototype.decode = async function () {
    await nativeDecode.call(this);
    decoded = true;
    naturalSize = [this.naturalWidth, this.naturalHeight];
    if (cancel) {
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      controller.abort();
      await held;
    }
  };
  try {
    const result = await prepareIdentityImage(
      new Blob([new Uint8Array(data)], { type: mime }),
      {
        signal: controller.signal,
        timeoutMs: 3000,
      },
    );
    const returnedBytes = new Uint8Array(await result.blob.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", returnedBytes);
    return {
      ok: true,
      asset: result.asset,
      naturalSize,
      decoded,
      returnedHash: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
      returnedBytesEqual:
        returnedBytes.length === data.length &&
        returnedBytes.every((byte, index) => byte === data.at(index)),
      returnedType: result.blob.type,
      returnedSize: result.blob.size,
      frozen: Object.isFrozen(result) && Object.isFrozen(result.asset),
      created: created - before.created,
      revoked: revoked - before.revoked,
      active: activeUrls.size,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "UNKNOWN",
      naturalSize,
      decoded,
      created: created - before.created,
      revoked: revoked - before.revoked,
      active: activeUrls.size,
    };
  } finally {
    release?.();
    HTMLImageElement.prototype.decode = nativeDecode;
  }
};
declare global {
  interface Window {
    identityImages: typeof harness;
    identityScriptExecuted?: boolean;
  }
}
window.identityImages = harness;
