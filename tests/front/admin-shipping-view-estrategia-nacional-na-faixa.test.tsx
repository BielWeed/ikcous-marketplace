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

  const previa = () =>
    hospedeiro.querySelector('[aria-label="Como fica para o cliente"]')!;
  const resumoGratis = () =>
    hospedeiro.querySelector("#painel-frete-gratis > button")!;
  it("a antiga faixa foi substituída por uma prévia de preço por modalidade", async () => {
    await abrirTela();
    expect(
      hospedeiro.querySelector('[aria-label="Como a entrega funciona hoje"]'),
    ).toBeNull();
    expect(previa().textContent).toContain("Entrega na sua região");
    expect(previa().textContent).toContain("Fora da sua região");
    expect(previa().querySelectorAll("[aria-pressed]")).toHaveLength(3);
  });
  it("as duas regras se identificam pela região, sem uma sobrescrever a outra", async () => {
    await abrirTela();
    expect(resumoGratis().textContent).toContain("Na região:");
    expect(resumoGratis().textContent).toContain("Fora:");
    expect(hospedeiro.querySelector('[role="tablist"]')?.textContent).toBe(
      "Na sua regiãoFora da região",
    );
  });
  it("o detalhe local nomeia entrega e retirada sem prometer grátis na transportadora", async () => {
    await abrirTela();
    expect(
      hospedeiro.querySelector("#bloco-frete-local-estrategias")?.textContent,
    ).toContain("Vale para a sua entrega e para a retirada na loja.");
  });
  it("o resumo da regra de fora preserva o mínimo e o alcance nacionais salvos", async () => {
    await abrirTela();
    expect(resumoGratis().textContent).toContain(
      "grátis acima de R$ 199 · todas as opções",
    );
  });
  it("sem regra nacional o cliente continua vendo o preço cotado na hora", async () => {
    estadoDaLoja.atual = {
      ...estadoDaLoja.atual,
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 0,
    };
    await abrirTela();
    expect(previa().textContent).toContain("preço da transportadora");
    expect(previa().textContent).toContain("Na hora");
  });
  it("a regra nacional abre na aba de fora de Frete grátis sem navegar para outra tela", async () => {
    await abrirTela();
    const b = resumoGratis() as HTMLButtonElement;
    await act(async () => b.click());
    const aba = hospedeiro.querySelector<HTMLButtonElement>(
      "#aba-gratis-nacional",
    )!;
    await act(async () => aba.click());
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(aba.getAttribute("aria-selected")).toBe("true");
    expect(
      hospedeiro.querySelector("#gratis-nacional")?.hasAttribute("hidden"),
    ).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
