import { IdentityError } from "./storeIdentity";

export function assertPublicSupabaseKey(key: string): void {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  try {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key))
      throw new Error();
    const segment = key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const decoded = atob(
      segment.padEnd(Math.ceil(segment.length / 4) * 4, "="),
    );
    const payload: unknown = JSON.parse(decoded);
    if (
      payload !== null &&
      typeof payload === "object" &&
      "role" in payload &&
      payload.role === "anon"
    )
      return;
  } catch {
    /* Only classify public legacy keys; the server verifies the signature. */
  }
  throw new IdentityError("IDENTITY_KEY");
}
