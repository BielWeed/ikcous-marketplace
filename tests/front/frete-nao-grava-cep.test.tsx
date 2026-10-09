// @vitest-environment jsdom
//
// O CEP da loja tem UMA casa: Minha loja (P2 do painel simples — o CEP da
// loja É o de onde saem as entregas). A tela "Entrega e frete" deixou de
// pedir e de gravar esse CEP: ela o LÊ, mostra "Entregas saem de: CEP …" e
// leva a Minha loja para quem quer mudar. Duas casas para o mesmo dado era
// o defeito: a lojista salvava aqui um CEP e em Minha loja outro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaLoja, updateConfig } = vi.hoisted(() => ({
  estadoDaLoja: {
    atual: {
      freeShippingMin: 0,
      shippingCoverage: "national" as "local" | "national",
      originCep: "01310-100" as string | undefined,
      enabledShippingMethods: ["sedex", "pac"] as string[],
      localDeliveryFee: 10,
      localCepRange: "",
    },
  },
  updateConfig: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const consulta = (): any =>
          Object.assign(Promise.resolve({ data: [], error: null }), {
            not: () => consulta(),
            neq: () => consulta(),
          });
        return consulta();
      },
    }),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Entrega e frete — lê o CEP de Minha loja e não grava", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    updateConfig.mockResolvedValue(true);
    estadoDaLoja.atual = {
      freeShippingMin: 0,
      shippingCoverage: "national",
      originCep: "01310-100",
      enabledShippingMethods: ["sedex", "pac"],
      localDeliveryFee: 10,
      localCepRange: "",
    };
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

  async function abrirTela(comNavegacao = true) {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active={true}
          onSetDirty={vi.fn()}
          onNavigate={comNavegacao ? onNavigate : undefined}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function botaoComTexto(texto: RegExp): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      texto.test(b.textContent || ""),
    ) as HTMLButtonElement | undefined;
  }

  it("o título da tela é 'Entrega e frete'", async () => {
    await abrirTela();
    expect(hospedeiro.querySelector("h1")?.textContent).toBe("Entrega e frete");
  });

  it("não existe mais campo de CEP nesta tela", async () => {
    await abrirTela();
    expect(hospedeiro.querySelector("#origin-cep")).toBeNull();
    expect(
      hospedeiro.querySelector('input[placeholder="00000-000"]'),
    ).toBeNull();
  });

  it("o Salvar do Frete grava as regras SEM originCep", async () => {
    await abrirTela();

    // Torna o formulário sujo por um campo que continua sendo desta tela.
    await act(async () => {
      (
        hospedeiro.querySelector(
          'button[role="switch"][aria-label="Só entregar na cidade"]',
        ) as HTMLButtonElement
      ).click();
    });
    const salvar = botaoComTexto(/^Salvar$/);
    expect(salvar?.disabled).toBe(false);
    await act(async () => {
      salvar?.click();
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const payload = updateConfig.mock.calls[0][0];
    expect(payload).not.toHaveProperty("originCep");
    // O que é desta tela segue indo.
    expect(payload).toHaveProperty("shippingCoverage", "local");
  });

  it("com CEP: mostra 'Entregas saem de: CEP …' e 'Alterar em Minha loja' leva a Minha loja", async () => {
    await abrirTela();

    expect(hospedeiro.textContent).toContain("Entregas saem de: CEP 01310-100");
    expect(hospedeiro.textContent?.toLowerCase()).not.toContain(
      "a loja não vende",
    );

    const alterar = botaoComTexto(/^Alterar em Minha loja$/);
    expect(alterar).toBeDefined();
    await act(async () => {
      alterar?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-about-store");
  });

  it("sem CEP: o aviso 'sem isso a loja não vende' leva a Minha loja", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, originCep: undefined };
    await abrirTela();

    const texto = hospedeiro.textContent?.toLowerCase() ?? "";
    expect(texto).toContain("sem isso a loja não vende");
    expect(texto).not.toContain("entregas saem de: cep");

    const cadastrar = botaoComTexto(/^Cadastrar CEP em Minha loja$/);
    expect(cadastrar).toBeDefined();
    await act(async () => {
      cadastrar?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-about-store");
  });

  it("sem CEP, a faixa de 'Na sua cidade' manda para Minha loja (não para 'abaixo')", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, originCep: "" };
    await abrirTela();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Parado — falta o CEP da loja");
    expect(texto).toContain("Minha loja");
    expect(texto).not.toMatch(/configure abaixo/i);
  });

  it("sem onNavigate não há botão morto: o texto do CEP continua lá", async () => {
    await abrirTela(false);
    expect(hospedeiro.textContent).toContain("Entregas saem de: CEP 01310-100");
    expect(botaoComTexto(/Alterar em Minha loja/)).toBeUndefined();
  });

  it("mudar o CEP em Minha loja (config de fora) não suja o formulário de Frete", async () => {
    await abrirTela();
    estadoDaLoja.atual = { ...estadoDaLoja.atual, originCep: "38400-000" };
    await abrirTela();

    expect(hospedeiro.textContent).toContain("Entregas saem de: CEP 38400-000");
    expect(botaoComTexto(/^Salvo$/)?.disabled).toBe(true);
  });
});
