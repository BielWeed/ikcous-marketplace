// @vitest-environment jsdom
//
// G9 do painel simples (spec §6): os ícones técnicos da identidade (Favicon,
// Ícone Apple, 192, 512, máscara) saem do primeiro plano e vão para a seção
// recolhível "Ícones do app (avançado)", com nomes de gente. A seção nasce
// FECHADA, mas nada desmonta: os 5 envios de ícone, a arte e as fontes
// guardadas continuam na árvore (ocultos), e o pacote da `save_store_identity`
// (as 8 chaves) sai idêntico com a seção fechada.
import { IdentitySettingsSection } from "@/components/admin/settings/IdentitySettingsSection";
import type { StoreIdentityIntent } from "@/lib/adminStoreIdentity";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  prepare: vi.fn(),
  prepareIcons: vi.fn(),
  upload: vi.fn(),
  refresh: vi.fn(),
  origin: "https://abcdefghijklmnopqrst.supabase.co",
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-a" },
    isAdmin: true,
    adminStatus: "admin",
    session: { user: { id: "admin-a" }, access_token: "synthetic-session" },
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeCity: "Uberlândia", storeState: "MG" },
    isLoaded: true,
    refresh: h.refresh,
  }),
}));
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
  prepareIdentityAppIcons: h.prepareIcons,
}));
vi.mock("@/lib/uploadIdentityImage", () => ({ uploadIdentityImage: h.upload }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error React testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ICONES = [
  "Trocar Ícone da aba do navegador",
  "Trocar Ícone do iPhone",
  "Trocar Ícone pequeno (192 × 192)",
  "Trocar Ícone grande (512 × 512)",
  "Trocar Ícone do Android (recortado)",
] as const;

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
    revision: "10",
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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function render() {
  await act(async () => {
    root.render(<IdentitySettingsSection active />);
  });
  await flush();
}
function botao(texto: string) {
  const el = [...host.querySelectorAll("button")].find(
    (node) => node.textContent === texto,
  );
  expect(el).toBeDefined();
  return el as HTMLButtonElement;
}
function envio(rotulo: string) {
  const el = host.querySelector<HTMLInputElement>(
    `input[type="file"][id="identity-upload-${encodeURIComponent(rotulo)}"]`,
  );
  expect(el, rotulo).not.toBeNull();
  return el as HTMLInputElement;
}
function cabecalhoDaSecao() {
  const el = [
    ...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
  ].find((b) => b.textContent?.includes("Ícones do app (avançado)"));
  expect(el).toBeDefined();
  return el as HTMLButtonElement;
}
/** O corpo que o cabeçalho controla (`aria-controls`). */
function corpoDa(cabecalho: HTMLButtonElement) {
  const el = document.getElementById(
    cabecalho.getAttribute("aria-controls") ?? "",
  );
  expect(el).not.toBeNull();
  return el as HTMLElement;
}
async function digitar(id: string, valor: string) {
  await act(async () => {
    const el = host.querySelector<HTMLInputElement>(`#${id}`)!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function escolher(rotulo: string, arquivo: File) {
  const el = envio(rotulo);
  await act(async () => {
    Object.defineProperty(el, "files", {
      configurable: true,
      value: [arquivo],
    });
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.read.mockReset();
  h.save.mockReset();
  h.prepare.mockReset();
  h.upload.mockReset();
  h.refresh.mockResolvedValue(undefined);
  h.read.mockImplementation(async () => snapshot());
  h.save.mockImplementation(async (intent: StoreIdentityIntent) => ({
    status: "confirmed",
    source: "response",
    snapshot: { revision: "11", identity: intent.desired },
  }));
  h.upload.mockImplementation(async (image) => ({
    asset: image.asset,
    url: `${h.origin}/storage/v1/object/public/branding/${image.asset.path}`,
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Ícones do app (avançado)", () => {
  it("nasce fechada, com os 5 ícones, a arte e as fontes montados mas ocultos", async () => {
    await render();
    const cabecalho = cabecalhoDaSecao();
    expect(cabecalho.getAttribute("aria-expanded")).toBe("false");
    const corpo = corpoDa(cabecalho);
    expect(corpo.hidden).toBe(true);
    for (const rotulo of [
      ...ICONES,
      "Trocar Arte de compartilhamento",
      "Adicionar fonte",
      "Substituir fonte 1",
    ]) {
      expect(corpo.contains(envio(rotulo)), rotulo).toBe(true);
    }
    expect(corpo.textContent).toContain("Fontes guardadas (1/8)");
    // o primeiro plano (prévias) continua fora da seção recolhível
    expect(corpo.contains(envio("Trocar ícone do aplicativo"))).toBe(false);
  });

  it("mesma ordem de antes: 5 ícones, arte e só então as fontes guardadas", async () => {
    await render();
    const corpo = corpoDa(cabecalhoDaSecao());
    const ids = [
      ...corpo.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ].map((el) => decodeURIComponent(el.id.replace("identity-upload-", "")));
    expect(ids).toEqual([
      ...ICONES,
      "Trocar Arte de compartilhamento",
      "Substituir fonte 1",
      "Adicionar fonte",
    ]);
  });

  it("sem jargão: nada de Favicon, Ícone Apple nem do <details> antigo", async () => {
    await render();
    expect(host.textContent).not.toMatch(/Favicon|[ÍI]cone Apple/);
    expect(host.textContent).not.toContain("Mais imagens da loja");
    expect(host.querySelector("details")).toBeNull();
  });

  it("abrir e fechar não desmonta nada (os mesmos nós de antes)", async () => {
    await render();
    const antes = ICONES.map(envio);
    await act(async () => cabecalhoDaSecao().click());
    expect(cabecalhoDaSecao().getAttribute("aria-expanded")).toBe("true");
    expect(ICONES.map(envio)).toEqual(antes);
    await act(async () => cabecalhoDaSecao().click());
    expect(cabecalhoDaSecao().getAttribute("aria-expanded")).toBe("false");
    expect(ICONES.map(envio)).toEqual(antes);
  });

  it("salvar a marca com a seção fechada manda o mesmo pacote de 8 chaves", async () => {
    await render();
    await digitar("store-name", "Loja Nova");
    await act(async () => botao("Salvar identidade").click());
    await flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    const intent = h.save.mock.calls[0][0] as StoreIdentityIntent;
    expect(Object.keys(intent.desired).sort()).toEqual([
      "accent_color",
      "branding_assets",
      "logo_url",
      "primary_color",
      "secondary_color",
      "store_city",
      "store_name",
      "store_state",
    ]);
    expect(intent.desired).toEqual({
      ...snapshot().identity,
      store_name: "Loja Nova",
    });
  });

  it("o ícone pequeno trocado com a seção fechada vai para o papel icon_192, e só ele", async () => {
    h.prepare.mockResolvedValueOnce({
      blob: new Blob(["custom"]),
      asset: asset("custom-192.png", 192, 192),
    });
    await render();
    await escolher(
      "Trocar Ícone pequeno (192 × 192)",
      new File(["png"], "icone.png", { type: "image/png" }),
    );
    expect(h.upload).toHaveBeenCalledTimes(1);
    await act(async () => botao("Salvar identidade").click());
    await flush();
    const salvos = (h.save.mock.calls[0][0] as StoreIdentityIntent).desired
      .branding_assets;
    expect(salvos).toEqual({
      ...snapshot().identity.branding_assets,
      icon_192: asset("custom-192.png", 192, 192),
    });
  });
});
