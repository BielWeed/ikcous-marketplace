import type { StoreIdentityIntent } from "@/lib/adminStoreIdentity";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  prepare: vi.fn(),
  upload: vi.fn(),
  refresh: vi.fn(),
  update: vi.fn(),
  dirty: vi.fn(),
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  auth: {
    user: { id: "admin-a" },
    isAdmin: true,
    adminStatus: "admin",
    session: { user: { id: "admin-a" }, access_token: "synthetic-session" },
  },
  config: { businessHours: "Antigo", shippingFee: 1 },
  version: 0,
  listeners: new Set<() => void>(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/contexts/StoreContext", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useStore: () => {
      useSyncExternalStore(
        (cb) => {
          h.listeners.add(cb);
          return () => {
            h.listeners.delete(cb);
          };
        },
        () => h.version,
      );
      return {
        config: h.config,
        isLoaded: true,
        updateConfig: h.update,
        refresh: h.refresh,
      };
    },
  };
});
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => h.origin,
  lerChaveSupabase: () => "sb_publishable_synthetic",
}));
vi.mock("@/lib/adminStoreIdentity", () => ({
  readAdminStoreIdentity: h.read,
  saveAdminStoreIdentity: h.save,
}));
vi.mock("@/lib/prepareIdentityImage", () => ({
  prepareIdentityImage: h.prepare,
}));
vi.mock("@/lib/uploadIdentityImage", () => ({ uploadIdentityImage: h.upload }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error React testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function asset(
  name: string,
  width?: number,
  height?: number,
  media_type = "image/png",
) {
  return {
    path: `v1/${"a".repeat(64)}/${name}`,
    sha256: "a".repeat(64),
    bytes: 100,
    media_type,
    ...(width === undefined ? {} : { width, height }),
  };
}
function snapshot() {
  return {
    revision: "9007199254740993",
    identity: {
      store_name: "Loja Teste",
      store_city: "Uberlândia",
      store_state: "MG",
      primary_color: "#ABCDEF",
      secondary_color: "#000000",
      accent_color: "#000000",
      logo_url: `${h.origin}/storage/v1/object/public/branding/${asset("header.svg").path}`,
      branding_assets: {
        version: 1,
        originals: [asset("source.svg", undefined, undefined, "image/svg+xml")],
        header: asset("header.svg", undefined, undefined, "image/svg+xml"),
        loader: asset("loader.svg", undefined, undefined, "image/svg+xml"),
        favicon: asset(
          "favicon.ico",
          undefined,
          undefined,
          "image/vnd.microsoft.icon",
        ),
        apple_touch: asset("apple.png", 180, 180),
        icon_192: asset("192.png", 192, 192),
        icon_512: asset("512.png", 512, 512),
        maskable_512: asset("mask.png", 512, 512),
        og: asset("og.png", 1200, 630),
      },
    },
  };
}
let root: Root;
let host: HTMLDivElement;
let mounted = true;
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
// A edição de identidade (IdentitySettingsSection) morava atrás de um
// acordeão em AdminSettingsView ("Nome, logo e cores") e SAIU de lá em
// 22/09/2026 — era duplicada de AdminAboutStoreView, que monta o MESMO
// componente sempre visível (bloco 1, "Marca da loja"). Este arquivo passou
// a renderizar a tela que continua editando de verdade.
async function render(active = true) {
  const { AdminAboutStoreView } = await import(
    "@/views/admin/AdminAboutStoreView"
  );
  await act(async () => {
    root.render(
      <AdminAboutStoreView
        active={active}
        onNavigate={vi.fn()}
        onSetDirty={h.dirty}
      />,
    );
  });
  await act(async () => {
    await import("@/components/admin/settings/IdentitySettingsSection");
  });
  await flush();
  await flush();
}

function input(id: string) {
  const el = host.querySelector<HTMLInputElement>(`#${id}`);
  expect(el).not.toBeNull();
  return el!;
}
function button(text: string) {
  const el = [...host.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  );
  expect(el).toBeDefined();
  return el!;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
  await flush();
}
async function type(id: string, value: string) {
  await act(async () => {
    const el = input(id);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  h.read.mockReset();
  h.save.mockReset();
  h.prepare.mockReset();
  h.upload.mockReset();
  h.refresh.mockResolvedValue(undefined);
  h.origin = "https://abcdefghijklmnopqrst.supabase.co";
  h.auth = {
    user: { id: "admin-a" },
    isAdmin: true,
    adminStatus: "admin",
    session: { user: { id: "admin-a" }, access_token: "synthetic-session" },
  };
  h.config = { businessHours: "Antigo", shippingFee: 1 };
  h.read.mockImplementation(async () => snapshot());
  h.save.mockImplementation(async (intent: StoreIdentityIntent) => ({
    status: "confirmed",
    source: "response",
    snapshot: { revision: "9007199254740994", identity: intent.desired },
  }));
  h.prepare.mockImplementation(async (file: File) => ({
    blob: file,
    asset: asset("new.svg", undefined, undefined, "image/svg+xml"),
  }));
  h.upload.mockImplementation(async (image) => ({
    asset: image.asset,
    url: `${h.origin}/storage/v1/object/public/branding/${image.asset.path}`,
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Minha loja — a cor agora mora em Aparência do app", () => {
  it("não exibe campos de cor e mantém o caminho até a tela nova", async () => {
    await render();
    expect(host.querySelector("#store-color-hex")).toBeNull();
    expect(host.querySelector("#store-secondary-color")).toBeNull();
    expect(host.querySelector("#store-accent-color")).toBeNull();
    expect(host.textContent).toContain("A cor do app fica em Aparência do app");
    expect(host.textContent).toContain(
      "Nome e logo que aparecem no app inteiro",
    );
  });
  it("salvar a Marca continua enviando as três cores salvas e as oito chaves", async () => {
    const before = snapshot();
    await render();
    await type("store-name", "Nova loja");
    await click("Salvar alterações");
    expect(h.save.mock.calls[0][0].desired).toEqual({
      ...before.identity,
      store_name: "Nova loja",
    });
    expect(Object.keys(h.save.mock.calls[0][0].desired)).toHaveLength(8);
    expect(h.update).not.toHaveBeenCalled();
  });
});
