import { describe, expect, it } from "vitest";
// @ts-expect-error Node entry is plain JavaScript; no TypeScript runner or declaration dependency.
import { deliveryContract } from "../../scripts/buildStore.mjs";
import {
  PUBLIC_DEFINE_KEYS,
  STORE_DELIVERY_API,
  SYNTHETIC_PUBLIC_SERVICE,
} from "../../src/config/storeDeliveryContract";
import { classifyPublicSupabaseKey } from "../../src/lib/publicSupabaseKey";
// @ts-expect-error Módulo nativo da bancada A6, sem declaração; confronto de literais.
import { publicKey } from "../browser-identity-app/contracts.mjs";
// @ts-expect-error Módulo nativo da bancada A6, sem declaração; confronto de literais.
import { serviceOrigin } from "../browser-identity-app/contracts.mjs";

const jwt = (role: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.fixture`;

describe("contrato da entrega preparada", () => {
  it("constantes congeladas e nomeadas como o observador espera", () => {
    expect(STORE_DELIVERY_API).toEqual({
      name: "ikcous-store-delivery",
      version: 1,
    });
    expect(Object.isFrozen(STORE_DELIVERY_API)).toBe(true);
    expect(PUBLIC_DEFINE_KEYS).toEqual({
      url: "import.meta.env.VITE_SUPABASE_URL",
      publishable: "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY",
      anon: "import.meta.env.VITE_SUPABASE_ANON_KEY",
    });
    expect(Object.isFrozen(PUBLIC_DEFINE_KEYS)).toBe(true);
  });

  it("par sintético é exatamente o da bancada A6, sem importar a bancada no produto", () => {
    expect(SYNTHETIC_PUBLIC_SERVICE).toEqual({
      origin: serviceOrigin,
      publishableKey: publicKey,
    });
    expect(Object.isFrozen(SYNTHETIC_PUBLIC_SERVICE)).toBe(true);
    expect(
      SYNTHETIC_PUBLIC_SERVICE.publishableKey.startsWith("sb_publishable_"),
    ).toBe(false);
  });

  it.each([
    ["sb_publishable_fixture_only", "publishable"],
    [jwt("anon"), "anon-jwt"],
  ])("classifica %s como %s", (key, expected) => {
    expect(classifyPublicSupabaseKey(key)).toBe(expected);
  });

  it.each([
    "sb_secret_fixture_only",
    jwt("service_role"),
    jwt("authenticated"),
    "a6c-public-artificial-key-no-account",
    "",
    "sb_publishable_fixture\nonly",
  ])("recusa %j com IDENTITY_KEY", (key) => {
    expect(() => classifyPublicSupabaseKey(key)).toThrow(/IDENTITY_KEY/);
  });

  it("espelho literal em buildStore.mjs é igual ao contrato TypeScript", () => {
    expect(deliveryContract).toEqual({
      api: STORE_DELIVERY_API,
      defineKeys: PUBLIC_DEFINE_KEYS,
      synthetic: SYNTHETIC_PUBLIC_SERVICE,
    });
    expect(Object.isFrozen(deliveryContract)).toBe(true);
    expect(Object.isFrozen(deliveryContract.api)).toBe(true);
  });
});
