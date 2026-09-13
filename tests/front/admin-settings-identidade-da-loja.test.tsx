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
// O título do acordeão mora no hub (AdminSettingsView) e muda com o desenho
// novo do lote E ("Identidade da loja" → "Nome, logo e cores"; "Horário de
// atendimento" → "Atendimento", tabela de vocabulário em
// equipe/entregas/20260913-lote-e-desenho-salao-e-porao.md). O locator aceita
// os DOIS títulos oficiais — o atual e o do desenho — para o teste sobreviver
// às duas ordens de pouso (hub antes ou depois desta peça) SEM afrouxar o
// alvo: continua exigindo o botão de seção colapsável (aria-expanded) cujo
// texto carrega um dos dois títulos.
function secaoColapsavel(tituloAtual: string, tituloNovo: string) {
  const el = [...host.querySelectorAll("button")].find(
    (node) =>
      node.getAttribute("aria-expanded") !== null &&
      (node.textContent?.includes(tituloAtual) ||
        node.textContent?.includes(tituloNovo)),
  );
  expect(el).toBeDefined();
  return el!;
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
  const section = secaoColapsavel("Identidade da loja", "Nome, logo e cores");
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

describe("Ajustes — identidade da loja pela RPC protegida", () => {
  it("salvar identidade não limpa horário pendente e recolher não perde os campos", async () => {
    await render();
    await type("store-name", "Novo nome");
    const section = secaoColapsavel("Identidade da loja", "Nome, logo e cores");
    await act(async () => section.click());
    expect(section.getAttribute("aria-expanded")).toBe("true");
    await act(async () =>
      secaoColapsavel("Horário de atendimento", "Atendimento").click(),
    );
    await flush();
    await type("store-business-hours", "Novo horário");
    await click("Salvar identidade");
    expect(h.dirty).toHaveBeenLastCalledWith(true);
    h.update.mockResolvedValue(true);
    await click("Salvar horário");
    expect(h.update).toHaveBeenCalledExactlyOnceWith(
      { businessHours: "Novo horário" },
      { isCurrent: expect.any(Function), silent: true },
    );
    expect(h.update.mock.calls[0][1].isCurrent()).toBe(true);
    expect(input("store-business-hours").value).toBe("Novo horário");
    expect(h.dirty).toHaveBeenLastCalledWith(false);
  });
  it("aba inativa não altera a guarda global, e a volta reapresenta sua pendência", async () => {
    await render();
    await type("store-name", "Não perdido");
    h.dirty.mockClear();
    await render(false);
    expect(h.dirty).not.toHaveBeenCalled();
    await render(true);
    expect(h.dirty).toHaveBeenLastCalledWith(true);
    expect(input("store-name").value).toBe("Não perdido");
  });
  it("horário tardio de usuário anterior não celebra nem altera novo editor", async () => {
    let resolve!: (value: boolean) => void;
    h.update.mockReturnValue(
      new Promise<boolean>((yes) => {
        resolve = yes;
      }),
    );
    await render();
    await act(async () =>
      secaoColapsavel("Horário de atendimento", "Atendimento").click(),
    );
    await flush();
    await type("store-business-hours", "Antigo usuário");
    await click("Salvar horário");
    h.auth = {
      ...h.auth,
      user: { id: "admin-b" },
      session: { user: { id: "admin-b" }, access_token: "synthetic-b" },
    };
    await render();
    await type("store-business-hours", "B editando");
    await act(async () => resolve(true));
    expect(input("store-business-hours").value).toBe("B editando");
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("mostra nome, cidade e estado da fotografia administrativa", async () => {
    await render();
    expect(input("store-name").value).toBe("Loja Teste");
    expect(input("store-city").value).toBe("Uberlândia");
    expect(input("store-state").value).toBe("MG");
  });
  it("preserva nome e cor digitados ao atualizar apenas config de horário/frete", async () => {
    await render();
    await type("store-name", "Meu rascunho");
    await type("store-color-hex", "#0");
    await act(async () => {
      h.config = { businessHours: "Outro", shippingFee: 99 };
      h.version++;
      for (const callback of h.listeners) callback();
    });
    expect(input("store-name").value).toBe("Meu rascunho");
    expect(input("store-color-hex").value).toBe("#0");
    expect(h.update).not.toHaveBeenCalled();
  });
  it("grava pacote único com nome/local, sem updateConfig e sem inventar nome vazio", async () => {
    await render();
    await type("store-name", "Minha Loja");
    await type("store-city", "Patos de Minas");
    await type("store-state", "mg");
    await click("Salvar identidade");
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][0].desired).toMatchObject({
      store_name: "Minha Loja",
      store_city: "Patos de Minas",
      store_state: "MG",
    });
    expect(h.update).not.toHaveBeenCalled();
    await type("store-name", " ");
    await click("Salvar identidade");
    expect(h.save).toHaveBeenCalledTimes(1);
  });
  it("falha mantém rascunho, guarda e não diz salvo", async () => {
    h.save.mockResolvedValue({ status: "rejected", code: "permission" });
    await render();
    await type("store-name", "Meu nome");
    await click("Salvar identidade");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(input("store-name").value).toBe("Meu nome");
    expect(h.dirty).toHaveBeenLastCalledWith(true);
    expect(host.textContent).not.toContain("Identidade salva no cadastro");
  });
  it("imagens avançadas ficam sob título de gente, com todos os uploads alcançáveis", async () => {
    await render();
    expect(host.textContent).toContain(
      "Mais imagens da loja (favicon, ícones, compartilhamento)",
    );
    expect(host.textContent).not.toContain("Ajustes avançados de imagens");
    // Renomear não pode esconder nada: as entradas de arquivo continuam na
    // árvore, inclusive a de adicionar fonte (jsdom mantém o conteúdo do
    // <details> na árvore esteja ele aberto ou fechado).
    expect(
      host.querySelector('input[id="identity-upload-Adicionar%20fonte"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('input[id^="identity-upload-Trocar%20"]'),
    ).not.toBeNull();
  });
});
