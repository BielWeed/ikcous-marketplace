import { branding } from "@/config/branding";
import type { StoreIdentityIntent } from "@/lib/adminStoreIdentity";
import { AdminAppColorView } from "@/views/admin/AdminAppColorView";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  dirty: vi.fn(),
  offline: false,
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
  useStore: () => ({ config: {}, refresh: h.refresh }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => h.origin,
  lerChaveSupabase: () => "sb_publishable_synthetic",
}));
vi.mock("@/lib/adminStoreIdentity", () => ({
  readAdminStoreIdentity: h.read,
  saveAdminStoreIdentity: h.save,
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.offline,
}));
// @ts-expect-error React testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function asset(name: string, width?: number, height?: number) {
  return {
    path: `v1/${"a".repeat(64)}/${name}`,
    sha256: "a".repeat(64),
    bytes: 100,
    media_type: "image/png",
    ...(width === undefined ? {} : { width, height }),
  };
}
function snapshot() {
  return {
    revision: "9007199254740993",
    identity: {
      store_name: " Loja Teste ",
      store_city: "Cidade Teste",
      store_state: "SP",
      primary_color: "#234567",
      secondary_color: "#059669",
      accent_color: "#f4f4f5",
      logo_url: `${h.origin}/storage/v1/object/public/branding/${asset("header.png").path}`,
      branding_assets: {
        version: 1,
        originals: [asset("original.png")],
        header: asset("header.png"),
        loader: asset("loader.png"),
        favicon: asset("favicon.png"),
        apple_touch: asset("apple.png", 180, 180),
        icon_192: asset("192.png", 192, 192),
        icon_512: asset("512.png", 512, 512),
        maskable_512: asset("mask.png", 512, 512),
        og: asset("og.png", 1200, 630),
      },
    },
  };
}
let host: HTMLDivElement;
let root: Root;
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
async function render(active = true) {
  await act(async () =>
    root.render(
      <AdminAppColorView
        active={active}
        onNavigate={vi.fn()}
        onSetDirty={h.dirty}
      />,
    ),
  );
  await flush();
}
function input() {
  return host.querySelector<HTMLInputElement>("#app-color-hex")!;
}
function button(text: string) {
  const b = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  expect(b, text).toBeDefined();
  return b!;
}
async function click(text: string) {
  await act(async () => button(text).click());
  await flush();
}
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  h.offline = false;
  h.read.mockReset().mockResolvedValue(snapshot());
  h.save
    .mockReset()
    .mockImplementation(async (intent: StoreIdentityIntent) => ({
      status: "confirmed",
      source: "response",
      snapshot: { revision: "9007199254740994", identity: intent.desired },
    }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Cor do app — tela com editor real e fotografia completa", () => {
  it("reserva no fim da tela o espaço da navegação inferior do painel", async () => {
    await render();
    const tela = host.firstElementChild!;
    // jsdom não mede a rolagem: verifica o uso da reserva compartilhada,
    // que inclui a barra, a área segura e a folga acima da navegação.
    expect(tela.classList.contains("pb-admin")).toBe(true);
    expect(tela.classList.contains("pb-8")).toBe(false);
    expect(tela.contains(host.querySelector("#app-color-preview-title"))).toBe(
      true,
    );
  });

  it("lê a cor salva; explica os usos e não muda a cor global na prévia", async () => {
    document.documentElement.style.setProperty("--primary", "valor-anterior");
    await render();
    expect(input().value.toLowerCase()).toBe("#234567");
    expect(button("Salvar cor").disabled).toBe(true);
    expect(host.textContent).toContain("Não muda a sua logo.");
    await type("0F766E");
    expect(input().value).toBe("#0F766E");
    expect(
      host.querySelector<HTMLElement>("[data-previa-cor]")!.style
        .backgroundColor,
    ).toBe("rgb(15, 118, 110)");
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "valor-anterior",
    );
    expect(h.save).not.toHaveBeenCalled();
    expect(h.dirty).toHaveBeenLastCalledWith(true);
  });

  it("salvar muda SOMENTE primary_color: compara as oito chaves e os assets completos", async () => {
    const before = snapshot();
    await render();
    await type("#0F766E");
    await click("Salvar cor");
    const intent = h.save.mock.calls[0][0] as StoreIdentityIntent;
    expect(intent.expected).toEqual(before);
    expect(intent.desired).toEqual({
      ...before.identity,
      primary_color: "#0f766e",
    });
    expect(Object.keys(intent.desired)).toHaveLength(8);
    expect(h.refresh).toHaveBeenCalledExactlyOnceWith({ onlyConfig: true });
    expect(host.textContent).toContain("Cor salva");
    expect(host.textContent).toContain(
      "Os clientes veem a nova cor ao abrir o app de novo.",
    );
    expect(h.dirty).toHaveBeenLastCalledWith(false);
  });

  it.each([
    ["#000000", "Preto puro não funciona bem"],
    ["#12", "Use o formato #RRGGBB:"],
    ["#xyz123", "Use o formato #RRGGBB:"],
  ])("recusa %s e conserva a última prévia válida", async (value, message) => {
    await render();
    await type("#0f766e");
    await type(value);
    expect(host.textContent).toContain(message);
    expect(button("Salvar cor").disabled).toBe(true);
    expect(
      host.querySelector<HTMLElement>("[data-previa-cor]")!.style
        .backgroundColor,
    ).toBe("rgb(15, 118, 110)");
    expect(host.textContent).toContain("Mostrando a última cor válida.");
    await click("Salvar cor");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("oferece o cinza do build em vez do preto e não salva sozinho", async () => {
    await render();
    await type("#000000");
    await click(`Usar ${branding.theme.primary.toUpperCase()}`);
    expect(input().value.toLowerCase()).toBe(
      branding.theme.primary.toLowerCase(),
    );
    expect(h.save).not.toHaveBeenCalled();
  });
  it("padrão e descarte só mudam o rascunho", async () => {
    await render();
    await click("Voltar ao padrão");
    expect(input().value.toLowerCase()).toBe(
      branding.theme.primary.toLowerCase(),
    );
    expect(button("Voltar ao padrão").disabled).toBe(true);
    expect(h.save).not.toHaveBeenCalled();
    await click("Descartar alterações");
    expect(input().value.toLowerCase()).toBe("#234567");
    expect(button("Salvar cor").disabled).toBe(true);
  });
  it("a cor clara usa texto escuro e o meio-termo só avisa, sem bloquear", async () => {
    await render();
    await type("#FACC15");
    expect(host.textContent).toContain("Texto escuro");
    expect(host.textContent).toContain("Fácil de ler");
    await type("#8B5CF6");
    expect(host.textContent).toContain("O texto pode ficar difícil de ler");
    expect(host.textContent).toContain("4,2 para 1");
    expect(button("Salvar cor").disabled).toBe(false);
  });
  it("offline desativa salvar, mas mantém campo e prévia", async () => {
    h.offline = true;
    await render();
    await type("#059669");
    expect(input().disabled).toBe(false);
    expect(button("Salvar cor").disabled).toBe(true);
    expect(host.textContent).toContain("Sem conexão com a internet");
    expect(h.save).not.toHaveBeenCalled();
  });
  it("trava campo, descarte e clique duplicado enquanto salva", async () => {
    let resolve!: (value: unknown) => void;
    h.save.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await render();
    await type("#059669");
    await click("Salvar cor");
    expect(input().disabled).toBe(true);
    expect(button("Descartar alterações").disabled).toBe(true);
    await click("Salvando cor…");
    expect(h.save).toHaveBeenCalledTimes(1);
    const intent = h.save.mock.calls[0][0] as StoreIdentityIntent;
    await act(async () =>
      resolve({
        status: "confirmed",
        source: "response",
        snapshot: { revision: "2", identity: intent.desired },
      }),
    );
  });
  it("rejeição preserva escolha e permite tentar de novo", async () => {
    h.save.mockResolvedValue({ status: "rejected", code: "invalid" });
    await render();
    await type("#123457");
    await click("Salvar cor");
    expect(input().value).toBe("#123457");
    expect(host.textContent).toContain("Não foi possível salvar a cor");
    expect(host.textContent).not.toContain("Cor salva");
    expect(button("Tentar de novo").disabled).toBe(false);
  });
  it("confirmação pendente só permite reler; não repete gravação", async () => {
    h.save.mockResolvedValue({ status: "pending" });
    await render();
    await type("#059669");
    await click("Salvar cor");
    expect(host.textContent).toContain(
      "Não deu para confirmar se a cor foi salva",
    );
    expect(input().disabled).toBe(true);
    h.read.mockResolvedValue({
      revision: "2",
      identity: h.save.mock.calls[0][0].desired,
    });
    await click("Conferir novamente");
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Cor salva");
  });
  it.each([true, false])("conflito: revisão da escolha = %s", async (keep) => {
    const current = snapshot();
    current.identity.primary_color = "#18181B";
    current.identity.store_name = "Outra marca";
    current.revision = "2";
    h.save.mockResolvedValue({
      status: "conflict",
      source: "readback",
      current,
    });
    await render();
    await type("#059669");
    await click("Salvar cor");
    expect(host.textContent).toContain("A marca da loja mudou em outro lugar");
    expect(host.textContent).toContain("#18181B");
    await click(keep ? "Revisar minha escolha" : "Usar a cor que está no app");
    expect(input().value.toLowerCase()).toBe(keep ? "#059669" : "#18181b");
    if (keep) {
      h.save.mockImplementation(async (intent: StoreIdentityIntent) => ({
        status: "confirmed",
        source: "response",
        snapshot: { revision: "3", identity: intent.desired },
      }));
      await click("Salvar cor");
      expect(h.save.mock.calls[1][0].desired).toEqual({
        ...current.identity,
        primary_color: "#059669",
      });
    }
  });
  it("carregamento e falha não chutam uma cor", async () => {
    h.read.mockReturnValue(new Promise(() => {}));
    await render();
    expect(host.textContent).toContain("Carregando a cor do app…");
    expect(input()).toBeNull();
  });
  it("falha de leitura permite somente tentar novamente", async () => {
    h.read.mockRejectedValueOnce(new Error("private"));
    await render();
    expect(host.textContent).toContain(
      "Não foi possível carregar a cor do app.",
    );
    expect(input()).toBeNull();
    await click("Tentar novamente");
    expect(input()).not.toBeNull();
  });
  it("sem cor escolhida usa a semente só na apresentação e preserva o expected nulo", async () => {
    const before = {
      ...snapshot(),
      identity: { ...snapshot().identity, primary_color: null },
    };
    h.read.mockResolvedValue(before);
    await render();
    expect(input().value.toLowerCase()).toBe(
      branding.theme.primary.toLowerCase(),
    );
    expect(host.textContent).toContain("Você ainda não escolheu uma cor");
    expect(button("Voltar ao padrão").disabled).toBe(true);
    expect(h.save).not.toHaveBeenCalled();
    await type("#0F766E");
    await click("Salvar cor");
    expect(h.save.mock.calls[0][0]).toEqual({
      expected: before,
      desired: { ...before.identity, primary_color: "#0f766e" },
    });
  });
  it("voltar à tela concilia a fotografia nova sem perder a escolha local", async () => {
    await render();
    await type("#0F766E");
    await render(false);
    const current = snapshot();
    current.revision = "2";
    current.identity.store_name = "Nome novo";
    current.identity.accent_color = "#AaBbCc";
    h.read.mockResolvedValue(current);
    await render(true);
    expect(input().value.toLowerCase()).toBe("#0f766e");
    await click("Salvar cor");
    expect(h.save.mock.calls[0][0]).toEqual({
      expected: current,
      desired: { ...current.identity, primary_color: "#0f766e" },
    });
  });
  it("não lê nem grava se a tela não está ativa", async () => {
    await render(false);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });
});
