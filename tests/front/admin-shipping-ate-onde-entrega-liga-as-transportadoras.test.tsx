// @vitest-environment jsdom
//
// Tela de Frete: a frase "Cliente de outro bairro: …" da opção "Só perto da
// loja" (16/10/2026) tem de dizer a verdade que o CHECKOUT diz. Ela promete
// "compra com transportadora, se tiver conta" só quando a regra pronta
// (`transportadoraVendeForaDaCidade` + `transportadoraFicaSemPagamento`, as
// mesmas do aviso fixo da tela) diz que a transportadora vende fora E o
// pagamento pelo app está ligado. Enquanto as transportadoras ainda estão
// sendo LIDAS (ou a leitura falhou) a tela não afirma nada — antes, lista
// vazia por "ainda carregando" virava "não consegue comprar" para quem tem
// transportadora.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cenario, mockConfig } = vi.hoisted(() => ({
  cenario: {
    bootPagamentoLigado: false,
    ligados: ["melhor_envio"] as string[],
    leituraFalha: false,
    segurarLeitura: null as Promise<void> | null,
  },
  mockConfig: {
    freeShippingMin: 0,
    shippingCoverage: "national" as "local" | "national",
    shippingProvider: "melhor_envio",
    originCep: "38400-100",
    enabledShippingMethods: ["sedex", "pac"] as string[],
    localDeliveryFee: 10,
    localCepRange: "",
    nationalShippingStrategy: "desligado",
    nationalShippingMin: 0,
    nationalDiscountType: null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "mais_barata",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/flags", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/lib/flags")>()),
  pagamentoOnlineLigado: () => cenario.bootPagamentoLigado,
}));

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
    functions: {
      invoke: async (_nome: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          if (cenario.segurarLeitura) await cenario.segurarLeitura;
          if (cenario.leituraFalha) {
            return { data: null, error: { message: "network error" } };
          }
          return {
            data: {
              success: true,
              modo: "multi",
              ligados: cenario.ligados,
              provedores: {
                melhor_envio: {
                  tem_chave: true,
                  sandbox: false,
                  servicos: null,
                },
                superfrete: {
                  tem_chave: false,
                  sandbox: false,
                  servicos: null,
                },
                frenet: { tem_chave: false, sandbox: false, servicos: null },
              },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  esquecerEcoDoPagamentoPeloApp,
  publicarPagamentoPeloApp,
} from "@/lib/pagamento-pelo-app-no-painel";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminShippingView: a frase do 'Só perto da loja' liga nas transportadoras e no pagamento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    esquecerEcoDoPagamentoPeloApp();
    cenario.bootPagamentoLigado = true;
    cenario.ligados = ["melhor_envio"];
    cenario.leituraFalha = false;
    cenario.segurarLeitura = null;
    mockConfig.shippingCoverage = "national";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    esquecerEcoDoPagamentoPeloApp();
    vi.restoreAllMocks();
  });

  async function assentar() {
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function abrirTela() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active={true}
          onSetDirty={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
    await assentar();
  }

  const efeito = () =>
    [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ].find((b) => (b.textContent ?? "").includes("Só perto da loja"))
      ?.textContent ?? "";

  it("transportadora ligada + pagamento pelo app ligado: compra com transportadora, se tiver conta", async () => {
    await abrirTela();
    expect(efeito()).toContain(
      "Cliente de outro bairro: compra com transportadora, se tiver conta.",
    );
  });

  it("transportadora ligada + pagamento pelo app DESLIGADO: não promete a compra", async () => {
    cenario.bootPagamentoLigado = false;
    await abrirTela();
    expect(efeito()).toContain("Cliente de outro bairro: não consegue comprar");
    expect(efeito()).toContain("pagamento pelo app");
    expect(efeito()).not.toContain("compra com transportadora");
  });

  it("o eco do servidor vale mais que o retrato do boot (religar o pagamento em Ajustes muda a frase)", async () => {
    cenario.bootPagamentoLigado = false;
    await abrirTela();
    expect(efeito()).not.toContain("compra com transportadora");
    await act(async () => {
      publicarPagamentoPeloApp(true);
    });
    expect(efeito()).toContain("compra com transportadora, se tiver conta");
  });

  it("nenhuma transportadora ligada: 'não consegue comprar'", async () => {
    cenario.ligados = [];
    await abrirTela();
    expect(efeito()).toContain(
      "Cliente de outro bairro: não consegue comprar.",
    );
  });

  it("'só entregar na cidade' ligado: 'não consegue comprar'", async () => {
    mockConfig.shippingCoverage = "local";
    await abrirTela();
    expect(efeito()).toContain(
      "Cliente de outro bairro: não consegue comprar.",
    );
    expect(efeito()).not.toContain("compra com transportadora");
  });

  it("leitura das transportadoras FALHOU: a frase some (não chuta)", async () => {
    cenario.leituraFalha = true;
    await abrirTela();
    expect(efeito()).not.toContain("Cliente de outro bairro");
    expect(efeito()).toContain("normalmente um pedaço do seu bairro.");
  });

  it("leitura AINDA em andamento: a frase some, e aparece certa quando a leitura chega (nunca 'não consegue comprar' por lista vazia)", async () => {
    let liberar: () => void = () => {};
    cenario.segurarLeitura = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    await abrirTela();
    expect(efeito()).not.toContain("Cliente de outro bairro");
    await act(async () => {
      liberar();
    });
    await assentar();
    expect(efeito()).toContain("compra com transportadora, se tiver conta");
  });
});
