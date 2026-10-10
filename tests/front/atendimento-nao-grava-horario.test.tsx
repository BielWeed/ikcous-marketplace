// @vitest-environment jsdom
//
// Painel simples, tarefa A1 (09/10/2026) — conserto de perda de dado real.
//
// Antes: a tela Atendimento tinha um campo de horário e ENVIAVA
// `businessHours` em todo "Salvar". Quem salvava só o WhatsApp regravava o
// horário que o formulário carregou na abertura — e podia apagar o que a
// lojista tinha acabado de salvar em "Sobre a Loja" (o editor único do
// horário é o BusinessHoursSection, em AdminAboutStoreView).
//
// O que este teste fixa:
//   • salvar o WhatsApp manda `updateConfig` SEM a chave `businessHours`;
//   • o bloco de contato não tem campo de horário nem o mostra: o horário é
//     editado SÓ no BusinessHoursSection (bloco "Horário de atendimento" de
//     Minha loja);
//   • o horário não conta como alteração não salva (onDirtyChange).
//
// ATUALIZAÇÃO do painel simples (D9/D11, 09/10/2026): a tela "Atendimento"
// (AdminWhatsAppConfigView) foi apagada; o WhatsApp virou o bloco Contato de
// Minha loja (`ContatoDaLoja`). O bloco de leitura do horário com o botão
// "Alterar em Minha loja" morreu junto — dentro de Minha loja o editor do
// horário já está a um bloco de distância. O contrato que protege o dado (o
// Salvar do contato nunca regrava o horário) continua inteiro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn(async () => true);
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    whatsappNumber: "",
    businessHours: "Seg a sex 9h–18h",
    shareText: "Confira [nome] por [preco]: [link]",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig,
    refresh: vi.fn(),
    products: [],
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Minha loja › Contato — não grava nem edita o horário (A1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.businessHours = "Seg a sex 9h–18h";
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

  async function abrirTela(props: {
    onDirtyChange?: (dirty: boolean) => void;
  }) {
    const { ContatoDaLoja } = await import(
      "@/components/admin/minha-loja/ContatoDaLoja"
    );
    await act(async () => {
      raiz.render(<ContatoDaLoja {...props} />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  function botao(texto: string): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(texto),
    );
  }

  async function digitarWhatsApp(valor: string) {
    const campo = hospedeiro.querySelector(
      "#settings-whatsapp",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await esperar(500); // flush do LocalBufferedInput (350 ms)
    });
  }

  it("salvar o WhatsApp manda updateConfig SEM a chave businessHours", async () => {
    await abrirTela({});
    await digitarWhatsApp("1198765432");

    await act(async () => {
      botao("Salvar")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await esperar(50);
    });

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const enviado = (
      updateConfig.mock.calls[0] as unknown as [Record<string, unknown>]
    )[0];
    expect(enviado).not.toHaveProperty("businessHours");
    expect(enviado).toEqual({
      whatsappNumber: "551198765432",
      shareText: "Confira [nome] por [preco]: [link]",
    });
  });

  it("o contato não tem campo de horário nem o mostra (o editor é o de Minha loja)", async () => {
    await abrirTela({});

    expect(hospedeiro.querySelector("#settings-business-hours")).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Seg a sex 9h–18h");
    expect(hospedeiro.textContent).not.toContain("Horário de atendimento");
    expect(botao("Alterar em Minha loja")).toBeUndefined();
  });

  it("tela intocada termina limpa: o horário não acusa alteração não salva", async () => {
    const onDirtyChange = vi.fn();
    await abrirTela({ onDirtyChange });

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("a tela inteira de Minha loja segue a mesma regra: o Salvar do contato não leva o horário", async () => {
    const onSetDirty = vi.fn();
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(
        <AdminAboutStoreView onNavigate={vi.fn()} onSetDirty={onSetDirty} />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
    await digitarWhatsApp("1198765432");

    await act(async () => {
      botao("Salvar contato")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await esperar(50);
    });

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const enviadoPelaTela = (
      updateConfig.mock.calls[0] as unknown as [Record<string, unknown>]
    )[0];
    expect(enviadoPelaTela).not.toHaveProperty("businessHours");
    expect(onSetDirty).toHaveBeenCalledWith(true);
  });
});
