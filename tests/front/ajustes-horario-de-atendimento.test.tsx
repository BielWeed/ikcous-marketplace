// @vitest-environment jsdom
//
// Laudo caça-bugs Savy (30/08), achado 4 + decisão do Gabriel: o horário de
// atendimento é configuração DA LOJISTA no painel — e o campo não existia.
// A sentinela de fábrica 'Seg-Sáb: 9h às 18h' chegou a ser publicada na
// vitrine como se fosse expediente real (causa raiz: ramo INSERT da
// upsert_store_config, migration 20261033000000).
//
// O que este teste fixa: a tela tem o campo "Horário de atendimento",
// carrega o que já está salvo, grava o que a lojista digitar e grava `null`
// quando ela apaga (ausência honesta — a vitrine omite, nunca inventa).
//
// O campo morava atrás do acordeão "Atendimento" em AdminSettingsView e
// SAIU de lá em 22/09/2026 (pedido do dono): era duplicado de
// AdminAboutStoreView, que monta o MESMO BusinessHoursSection sempre
// visível (bloco 3). Este arquivo passou a renderizar a tela que continua
// editando de verdade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-a" },
    session: { user: { id: "admin-a" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
// AdminAboutStoreView monta também IdentitySettingsSection (bloco 1, sempre
// visível), que chama lerChaveSupabase() — fora do escopo deste arquivo
// (só horário), mas precisa existir no mock para não sobrar rejeição não
// tratada quando o efeito de leitura da identidade dispara.
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
  lerChaveSupabase: () => "sb_publishable_synthetic",
}));
const updateConfig = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    storeCity: "Monte Carmelo",
    storeState: "MG",
    businessHours: "Seg-Sáb: 9h às 18h",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Sobre a Loja — Horário de atendimento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(<AdminAboutStoreView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function pegarCampo(id: string): HTMLInputElement {
    const campo = hospedeiro.querySelector(`#${id}`) as HTMLInputElement;
    expect(campo).toBeDefined();
    return campo;
  }

  function pegarBotaoSalvar(): HTMLButtonElement {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar horário"),
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    return botao;
  }

  function digitar(campo: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("o campo existe e nasce com o horário já salvo no banco", async () => {
    await abrirTela();
    expect(pegarCampo("store-business-hours").value).toBe("Seg-Sáb: 9h às 18h");
  });

  it("grava o horário que a lojista digitar", async () => {
    updateConfig.mockResolvedValue(true);
    await abrirTela();

    await act(async () =>
      digitar(pegarCampo("store-business-hours"), "Ter-Sáb: 8h às 17h"),
    );
    await act(async () => {
      pegarBotaoSalvar().click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledWith(
      { businessHours: "Ter-Sáb: 8h às 17h" },
      { isCurrent: expect.any(Function), silent: true },
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("campo apagado grava NULL (a loja não disse — a vitrine omite)", async () => {
    updateConfig.mockResolvedValue(true);
    await abrirTela();

    await act(async () => digitar(pegarCampo("store-business-hours"), "   "));
    await act(async () => {
      pegarBotaoSalvar().click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledWith(
      { businessHours: null },
      { isCurrent: expect.any(Function), silent: true },
    );
  });

  it("falha de gravação não comemora (mesma régua do ADMIN-010)", async () => {
    updateConfig.mockResolvedValue(false);
    await abrirTela();

    await act(async () =>
      digitar(pegarCampo("store-business-hours"), "Outro horário"),
    );
    await act(async () => {
      pegarBotaoSalvar().click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
