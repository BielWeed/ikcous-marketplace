import type { Upload } from "tus-js-client";
import { normalizeSupabaseOrigin, parseIdentityAsset } from "./storeIdentity";
import type { IdentityAsset } from "./storeIdentity";
import type { UploadIdentityImageOptions } from "./uploadIdentityImage";

type TusUrlStorage = NonNullable<
  ConstructorParameters<typeof Upload>[1]["urlStorage"]
>;
export interface IdentityUploadResumeOptions {
  readonly origin: string;
  readonly userId: string;
  readonly asset: IdentityAsset;
  readonly storage: UploadIdentityImageOptions["storage"];
  readonly isActive: () => boolean;
  readonly validateUploadUrl: (url: string) => void;
  readonly nowMs: () => number;
}
export interface IdentityUploadResume {
  readonly urlStorage: TusUrlStorage;
  readonly fingerprint: string;
  clearConfirmed(uploadUrl: string): void;
}
interface ResumeRecord {
  version: 1;
  origin: string;
  userId: string;
  path: string;
  sha256: string;
  bytes: number;
  mediaType: IdentityAsset["media_type"];
  uploadUrl: string;
  createdAt: number;
}
const fields = [
  "version",
  "origin",
  "userId",
  "path",
  "sha256",
  "bytes",
  "mediaType",
  "uploadUrl",
  "createdAt",
];
const ttl = 24 * 60 * 60 * 1000;
async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createIdentityUploadResume(
  options: IdentityUploadResumeOptions,
): Promise<IdentityUploadResume> {
  const {
    userId,
    isActive,
    validateUploadUrl,
    nowMs,
    storage: suppliedStorage,
  } = options;
  const origin = normalizeSupabaseOrigin(options.origin);
  const asset = parseIdentityAsset(options.asset);
  if (
    typeof userId !== "string" ||
    !userId.trim() ||
    userId.length > 128 ||
    typeof isActive !== "function" ||
    typeof validateUploadUrl !== "function" ||
    typeof nowMs !== "function"
  )
    throw new Error("IDENTITY_UPLOAD_INVALID");
  const active = () => {
    try {
      return isActive() === true;
    } catch {
      return false;
    }
  };
  if (!active()) throw new Error("IDENTITY_UPLOAD_CANCELED");
  const fingerprint = await hash(
    JSON.stringify([
      origin,
      userId,
      asset.path,
      asset.sha256,
      asset.bytes,
      asset.media_type,
    ]),
  );
  if (!active()) throw new Error("IDENTITY_UPLOAD_CANCELED");
  const userHash = await hash(userId);
  if (!active()) throw new Error("IDENTITY_UPLOAD_CANCELED");
  const prefix = `ikcous.identityUpload.v1.${new URL(origin).hostname.split(".")[0]}.${userHash}.`;
  const key = prefix + fingerprint;
  let storage = suppliedStorage;
  if (storage === undefined) {
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
  }
  // Storage can throw (privacy mode, quota) or execute caller code. Each access is
  // guarded; persistence is optional and never blocks the upload itself.
  function remove(k: string) {
    if (!active()) return;
    try {
      storage?.removeItem(k);
    } catch {
      /* Local persistence is optional. */
    }
  }
  function read(
    k: string,
    exact: boolean,
    discardInvalid = true,
  ): ResumeRecord | undefined {
    if (!storage || !active()) return;
    let raw: string | null;
    try {
      raw = storage.getItem(k);
    } catch {
      return;
    }
    if (!active() || raw === null) return;
    try {
      if (
        raw.length > 8192 ||
        !k.startsWith(prefix) ||
        !/^[a-f0-9]{64}$/.test(k.slice(prefix.length))
      )
        throw new Error();
      const record = JSON.parse(raw) as ResumeRecord;
      if (
        !record ||
        typeof record !== "object" ||
        Object.keys(record).length !== fields.length ||
        !fields.every((f) => Object.hasOwn(record, f))
      )
        throw new Error();
      const parsed = parseIdentityAsset({
        path: record.path,
        sha256: record.sha256,
        bytes: record.bytes,
        media_type: record.mediaType,
      });
      const now = nowMs();
      if (
        record.version !== 1 ||
        record.origin !== origin ||
        record.userId !== userId ||
        !Number.isFinite(now) ||
        !Number.isFinite(record.createdAt) ||
        record.createdAt < 0 ||
        record.createdAt > now ||
        now - record.createdAt >= ttl
      )
        throw new Error();
      if (
        exact &&
        (k !== key ||
          parsed.path !== asset.path ||
          parsed.sha256 !== asset.sha256 ||
          parsed.bytes !== asset.bytes ||
          parsed.media_type !== asset.media_type)
      )
        throw new Error();
      validateUploadUrl(record.uploadUrl);
      if (!active()) return;
      return record;
    } catch {
      if (discardInvalid) remove(k);
      return;
    }
  }
  function find() {
    const record = read(key, true);
    if (!record || !active()) return [];
    return [
      {
        size: asset.bytes,
        metadata: {
          bucketName: "branding",
          objectName: asset.path,
          contentType: asset.media_type,
          cacheControl: "31536000",
        },
        creationTime: new Date(record.createdAt).toISOString(),
        urlStorageKey: key,
        uploadUrl: record.uploadUrl,
        parallelUploadUrls: null,
      },
    ];
  }
  let observedUrl: string | undefined;
  const urlStorage: TusUrlStorage = {
    async findAllUploads() {
      const found = find();
      observedUrl = found[0]?.uploadUrl;
      return found;
    },
    async findUploadsByFingerprint(value) {
      if (value !== fingerprint) return [];
      const found = find();
      observedUrl = found[0]?.uploadUrl;
      return found;
    },
    async removeUpload(k) {
      // TUS calls this for a missing/expired resource. Preserve another tab's
      // replacement and preserve valid references on ordinary cancellation.
      if (
        k === key &&
        observedUrl &&
        read(key, true)?.uploadUrl === observedUrl
      )
        remove(key);
    },
    async addUpload(value, upload) {
      if (
        !storage ||
        !active() ||
        value !== fingerprint ||
        upload.parallelUploadUrls != null ||
        typeof upload.uploadUrl !== "string"
      )
        return key;
      const uploadUrl = upload.uploadUrl;
      try {
        validateUploadUrl(uploadUrl);
      } catch {
        return key;
      }
      if (!active()) return key;
      const previous = read(key, true);
      const createdAt =
        previous?.uploadUrl === uploadUrl ? previous.createdAt : nowMs();
      if (!Number.isFinite(createdAt) || createdAt < 0 || !active()) return key;
      const retained: { key: string; createdAt: number }[] = [];
      try {
        const keys: string[] = [];
        const length = storage.length;
        for (let i = 0; i < length && active(); i++) {
          const candidate = storage.key(i);
          if (candidate?.startsWith(prefix)) keys.push(candidate);
        }
        for (const candidate of keys) {
          const record = read(candidate, candidate === key);
          if (record && candidate !== key)
            retained.push({ key: candidate, createdAt: record.createdAt });
        }
        retained.sort(
          (a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key),
        );
        while (retained.length >= 32) remove(retained.shift()!.key);
        const record: ResumeRecord = {
          version: 1,
          origin,
          userId,
          path: asset.path,
          sha256: asset.sha256,
          bytes: asset.bytes,
          mediaType: asset.media_type,
          uploadUrl,
          createdAt,
        };
        if (active()) storage.setItem(key, JSON.stringify(record));
        if (active()) observedUrl = uploadUrl;
      } catch {
        /* A full quota must not turn a successful request into failure. */
      }
      return key;
    },
  };
  return {
    fingerprint,
    urlStorage,
    clearConfirmed(uploadUrl) {
      if (read(key, true, false)?.uploadUrl === uploadUrl) remove(key);
    },
  };
}
