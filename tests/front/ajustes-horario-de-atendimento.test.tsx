// @vitest-environment jsdom
//
// Laudo caça-bugs Savy (30/08), achado 4 + decisão do Gabriel: o horário de
// atendimento é configuração DA LOJISTA no painel — e o campo não existia.
// A sentinela de fábrica 'Seg-Sáb: 9h às 18h' chegou a ser publicada na
// vitrine como se fosse expediente real (causa raiz: ramo INSERT da
// upsert_store_config, migration 20261033000000).
//
// O que este teste fixa: Ajustes tem o campo "Horário de atendimento",
// carrega o que já está salvo, grava o que a lojista digitar e grava `null`
// quando ela apaga (ausência honesta — a vitrine omite, nunca inventa).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("AdminSettingsView — Horário de atendimento", () => {
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
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={true} />);
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
      b.textContent?.includes("Salvar"),
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

    digitar(pegarCampo("store-business-hours"), "Ter-Sáb: 8h às 17h");
    await act(async () => {
      pegarBotaoSalvar().click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ businessHours: "Ter-Sáb: 8h às 17h" }),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("campo apagado grava NULL (a loja não disse — a vitrine omite)", async () => {
    updateConfig.mockResolvedValue(true);
    await abrirTela();

    digitar(pegarCampo("store-business-hours"), "   ");
    await act(async () => {
      pegarBotaoSalvar().click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ businessHours: null }),
    );
  });

  it("falha de gravação não comemora (mesma régua do ADMIN-010)", async () => {
    updateConfig.mockResolvedValue(false);
    await abrirTela();

    digitar(pegarCampo("store-business-hours"), "Seg-Sáb: 9h às 18h");
    await act(async () => {
      pegarBotaoSalvar().click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
