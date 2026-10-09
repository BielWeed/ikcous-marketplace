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
//   • o bloco 2 mostra o horário como TEXTO (leitura) e oferece o botão
//     "Alterar em Minha loja", que leva a "admin-about-store";
//   • o horário não conta como alteração não salva (onSetDirty).
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

describe("Atendimento — não grava nem edita o horário (A1)", () => {
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
    onNavigate?: (view: string) => void;
    onSetDirty?: (dirty: boolean) => void;
  }) {
    const { AdminWhatsAppConfigView } =
      await import("@/views/admin/AdminWhatsAppConfigView");
    await act(async () => {
      raiz.render(<AdminWhatsAppConfigView active {...(props as object)} />);
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
    await abrirTela({ onNavigate: vi.fn() });
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

  it("o bloco 2 mostra o horário como texto, sem campo, e leva a Minha loja", async () => {
    const onNavigate = vi.fn();
    await abrirTela({ onNavigate });

    const bloco = [
      ...hospedeiro.querySelectorAll<HTMLElement>("section[aria-labelledby]"),
    ].find(
      (s) => s.querySelector("h2")?.textContent === "Horário de atendimento",
    )!;
    expect(bloco).toBeTruthy();

    // Leitura: o horário salvo aparece como texto; nenhum campo editável.
    expect(bloco.textContent).toContain("Seg a sex 9h–18h");
    expect(hospedeiro.querySelector("#settings-business-hours")).toBeNull();
    expect(bloco.querySelector("input, textarea")).toBeNull();

    const alterar = botao("Alterar em Minha loja");
    expect(alterar).toBeTruthy();
    await act(async () => {
      alterar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-about-store");
  });

  it("sem horário salvo, o bloco diz que não há horário (e ainda leva a Minha loja)", async () => {
    mockConfig.businessHours = "";
    const onNavigate = vi.fn();
    await abrirTela({ onNavigate });

    expect(hospedeiro.textContent).toContain("Nenhum horário definido");
    await act(async () => {
      botao("Alterar em Minha loja")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-about-store");
  });

  it("tela intocada termina limpa: o horário só lido não acusa alteração não salva", async () => {
    const onSetDirty = vi.fn();
    await abrirTela({ onNavigate: vi.fn(), onSetDirty });

    // (A primeira renderização, antes da sincronia inicial com a config, é
    // transitória e preexistente; o que vale é o estado em repouso.)
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
  });
});
