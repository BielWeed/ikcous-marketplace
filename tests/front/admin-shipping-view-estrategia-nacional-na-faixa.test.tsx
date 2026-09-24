import type { View } from "@/types";
// @vitest-environment jsdom
//
// TAREFA T4 (23/09/2026): a tela de Frete distingue LOCAL de NACIONAL sem
// virar 4 colunas — a coluna que antes dizia "Frete grátis" (a regra que
// hoje só vale para local-delivery/store-pickup, T3) passa a se identificar
// como LOCAL; o resumo da estratégia NACIONAL entra curto no detalhe da
// coluna "Fora da cidade" (que já é sobre transportadora). E o botão
// "Estratégias do frete nacional →" (dentro de "Fora da cidade") mostra o
// estado salvo e navega para a tela nova.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaLoja, estadoDoBanco, updateConfig, invoke } = vi.hoisted(
  () => ({
    estadoDaLoja: {
      atual: {
        freeShippingMin: 100,
        shippingCoverage: "national" as "local" | "national",
        originCep: "38400-000",
        enabledShippingMethods: ["sedex", "pac"] as string[],
        localDeliveryFee: 10,
        localCepRange: "",
        storeCity: "Uberlândia" as string | null,
        storeState: "MG" as string | null,
        nationalShippingStrategy: "acima_de_valor" as
          | "desligado"
          | "acima_de_valor"
          | "sempre"
          | "por_produto"
          | "desconto_na_mais_barata",
        nationalShippingMin: 199,
        nationalDiscountType: null as "percentual" | "fixo" | null,
        nationalDiscountValue: 0,
        nationalBenefitScope: "todas" as "mais_barata" | "todas",
      },
    },
    estadoDoBanco: {
      ligados: ["melhor_envio"] as string[],
      provedores: {
        melhor_envio: { tem_chave: true, sandbox: false },
      } as Record<string, { tem_chave: boolean; sandbox?: boolean }>,
    },
    updateConfig: vi.fn(),
    invoke: vi.fn(),
  }),
);

function respostaConfig() {
  return {
    success: true,
    modo: estadoDoBanco.ligados.length > 0 ? "multi" : "legado",
    ligados: estadoDoBanco.ligados,
    provedores: {
      melhor_envio: { tem_chave: false, sandbox: false, servicos: null },
      superfrete: { tem_chave: false, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
      ...Object.fromEntries(
        Object.entries(estadoDoBanco.provedores).map(([p, v]) => [
          p,
          { servicos: null, ...v },
        ]),
      ),
    },
  };
}

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
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
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

describe("AdminShippingView — a faixa distingue local de nacional, e o botão de estratégias nacionais existe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onNavigate: ReturnType<typeof vi.fn<(view: View) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    // O jsdom não implementa scrollIntoView (mesmo stub das telas de
    // Pedidos) — o botão "Estratégias do frete nacional" agora rola até o
    // bloco em vez de navegar (T4 unificação, 23/09/2026).
    Element.prototype.scrollIntoView =
      vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
    estadoDaLoja.atual = {
      freeShippingMin: 100,
      shippingCoverage: "national",
      originCep: "38400-000",
      enabledShippingMethods: ["sedex", "pac"],
      localDeliveryFee: 10,
      localCepRange: "",
      storeCity: "Uberlândia",
      storeState: "MG",
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 199,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "todas",
    };
    estadoDoBanco.ligados = ["melhor_envio"];
    estadoDoBanco.provedores = { melhor_envio: { tem_chave: true } };
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: respostaConfig(), error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    updateConfig.mockResolvedValue(true);
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
    onNavigate = vi.fn<(view: View) => void>();
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active={true}
          onSetDirty={vi.fn()}
          onNavigate={onNavigate}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const textoDaFaixa = () =>
    hospedeiro.querySelector('[aria-label="Como a entrega funciona hoje"]')
      ?.textContent ?? "";

  it("a faixa continua com 3 colunas (nenhuma 4ª coluna nasceu)", async () => {
    await abrirTela();
    const faixa = hospedeiro.querySelector(
      '[aria-label="Como a entrega funciona hoje"]',
    );
    // As 3 colunas são os filhos diretos do grid — o rótulo de cada uma
    // aparece em uppercase (classe `uppercase`) uma vez por coluna.
    const rotulos = [...(faixa?.querySelectorAll(".uppercase") ?? [])];
    expect(rotulos).toHaveLength(3);
  });

  it("a coluna que era 'Frete grátis' agora se identifica como LOCAL", async () => {
    await abrirTela();
    expect(textoDaFaixa()).toMatch(/frete gr[áa]tis local/i);
  });

  it("REVISÃO (correção 4): o detalhe da coluna local nomeia cidade/retirada — nunca 'entrega' sem dizer onde", async () => {
    await abrirTela();
    expect(textoDaFaixa()).toMatch(
      /n[ãa]o paga entrega na cidade nem retirada/i,
    );
  });

  it("a coluna 'Fora da cidade' mostra o resumo curto da estratégia NACIONAL salva", async () => {
    await abrirTela();
    expect(textoDaFaixa()).toContain(
      "grátis acima de R$ 199 · todas as opções",
    );
  });

  it("estratégia nacional 'desligado': a coluna 'Fora da cidade' não perde o texto de conexão (nada de resumo vazio poluindo)", async () => {
    estadoDaLoja.atual = {
      ...estadoDaLoja.atual,
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 0,
    };
    await abrirTela();
    expect(textoDaFaixa()).toMatch(/cota[çc][ãa]o real na hora/i);
    expect(textoDaFaixa()).not.toContain("desligado ·");
  });

  // T4-UNIFICAÇÃO (23/09/2026): o botão deixou de NAVEGAR para uma tela
  // própria — a estratégia nacional agora mora no MESMO painel "Fora da
  // cidade". Clicar garante o painel aberto (`aria-expanded="true"`) em
  // vez de chamar `onNavigate`.
  it("o botão 'Estratégias do frete nacional' abre o painel 'Fora da cidade' (não navega mais)", async () => {
    await abrirTela();
    const botaoPainel = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^fora da cidade/i.test(b.textContent?.trim() || ""),
    ) as HTMLButtonElement;
    expect(botaoPainel).toBeDefined();
    expect(botaoPainel.getAttribute("aria-expanded")).toBe("false");

    const botaoEstrategias = [...hospedeiro.querySelectorAll("button")].find(
      (b) => /estrat[ée]gias do frete nacional/i.test(b.textContent || ""),
    ) as HTMLButtonElement;
    expect(botaoEstrategias).toBeDefined();
    await act(async () => {
      botaoEstrategias.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onNavigate).not.toHaveBeenCalledWith("admin-shipping-national");
    expect(botaoPainel.getAttribute("aria-expanded")).toBe("true");
  });
});
