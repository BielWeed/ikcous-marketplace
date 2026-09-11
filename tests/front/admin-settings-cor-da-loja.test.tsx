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
async function render(active = true) {
  const { AdminSettingsView } = await import("@/views/admin/AdminSettingsView");
  await act(async () => {
    root.render(
      <AdminSettingsView
        active={active}
        onNavigate={vi.fn()}
        onSetDirty={h.dirty}
      />,
    );
  });
  const section = [...host.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Identidade da loja"),
  )!;
  if (section.getAttribute("aria-expanded") === "false")
    await act(async () => section.click());
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

describe("Ajustes — cor principal na identidade", () => {
  it("exibe a fotografia do banco, sem usar a semente do build para gravar", async () => {
    await render();
    expect(input("store-color-hex").value).toBe("#ABCDEF");
  });
  it("recusa preto primário sem gravar e explica a recusa no formulário", async () => {
    await render();
    await type("store-color-hex", "#000000");
    await click("Salvar identidade");
    expect(h.save).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Preto não pode ser a cor da loja");
  });
  it("hex com letras aceita maiúsculas e grava o canônico do novo codec", async () => {
    await render();
    await type("store-color-hex", "#ff5733");
    await click("Salvar identidade");
    expect(h.save.mock.calls[0][0].desired.primary_color).toBe("#FF5733");
    expect(h.update).not.toHaveBeenCalled();
  });
  it("hex numérico válido chega ao pacote e refresh somente lê", async () => {
    await render();
    await type("store-color-hex", "#059669");
    await click("Salvar identidade");
    expect(h.save.mock.calls[0][0].desired.primary_color).toBe("#059669");
    expect(h.refresh).toHaveBeenCalledExactlyOnceWith({ onlyConfig: true });
  });
  it("formato inválido é recusado antes da RPC", async () => {
    await render();
    await type("store-color-hex", "verde");
    await click("Salvar identidade");
    expect(h.save).not.toHaveBeenCalled();
    expect(host.textContent).toContain("#RRGGBB");
  });
  it("falha de gravação não celebra nem apaga a cor digitada", async () => {
    h.save.mockResolvedValue({ status: "rejected", code: "invalid" });
    await render();
    await type("store-color-hex", "#123456");
    await click("Salvar identidade");
    expect(input("store-color-hex").value).toBe("#123456");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Identidade salva no cadastro");
  });
});
