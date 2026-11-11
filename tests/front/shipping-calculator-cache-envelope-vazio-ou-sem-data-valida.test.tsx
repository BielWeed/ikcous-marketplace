// @vitest-environment jsdom
//
// CACHE DE FRETE DO NAVEGADOR: envelope SEM opção e envelope SEM DATA VÁLIDA
// não valem como "acerto" (caça r122, achados 1 e 2 do território
// frete-no-checkout).
//
// 1) Envelope com `opcoes: []` (a loja estava sem transportadora no momento da
//    cotação; a edge devolveu `options: []` e o componente gravou assim mesmo).
//    Servido como acerto, a volta ao checkout no mesmo CEP e carrinho deixava o
//    frete em "cotando" para sempre: sem spinner, sem a frase "A calcular:
//    nenhuma opção de entrega", sem "Tentar de novo" e sem consulta nova — o
//    Finalizar travado em silêncio por até 2 h, mesmo depois de a lojista
//    conectar a transportadora.
// 2) Envelope sem `gravadoEm` numérico (`agora - undefined` = NaN, e as duas
//    comparações de idade dão falso) ou com data NO FUTURO (relógio que andou
//    para trás, ou data adulterada): ficaria "fresco" para sempre / até o
//    relógio alcançar a data. O preço do frete entra no total do pedido.
//
// O que distingue "serviu o cache" de "foi à rede" é QUAL chamada a edge
// recebeu: acerto de cache só faz a confirmação da revisão (`action:
// "revisao_config_frete"`, sem `cart`); ida à rede faz a cotação (com `cart`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chaveDoCacheDeFrete,
  cotacaoCacheadaQueAindaServe,
} from "@/components/ui/custom/ShippingCalculator";
import {
  ContextoDoFreteDaLoja,
  contextoDaLojaParaFrete,
} from "@/contexts/ContextoDoFreteDaLoja";
import type { CartItem, Product, ShippingOption, StoreConfig } from "@/types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CEP = "01001000";
const LOJA_SF: Partial<StoreConfig> = {
  shippingProvider: "superfrete",
  enabledShippingMethods: ["sedex", "pac"],
  storeAddress: "",
};
const REVISAO_FIXA_DO_TESTE = "rev-fixa-do-teste";
const ASSINATURA = "prod-tenis-teste::1:59.9";
const UMA_HORA_MS = 60 * 60 * 1000;
const UM_ANO_MS = 365 * 24 * UMA_HORA_MS;

const OPCAO: ShippingOption = {
  id: "superfrete-17",
  name: "Entrega econômica",
  price: 19.01,
  deliveryDays: 11,
  provider: "superfrete",
};

function produto(): Product {
  return {
    id: "prod-tenis-teste",
    name: "Tênis de Teste",
    description: "",
    price: 59.9,
    images: [],
    category: "Calçados",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}
const CARRINHO: CartItem[] = [{ product: produto(), quantity: 1 }];

type CorpoDaChamada = { body?: { action?: string; cart?: unknown } };

describe("cotacaoCacheadaQueAindaServe — envelope sem opção ou sem data válida", () => {
  const agora = Date.now();
  const contexto = contextoDaLojaParaFrete(LOJA_SF);
  const envelope = (sobrescritas: Record<string, unknown> = {}) => ({
    contexto,
    assinatura: ASSINATURA,
    gravadoEm: agora - 60_000,
    revisaoConfig: REVISAO_FIXA_DO_TESTE,
    opcoes: [OPCAO],
    ...sobrescritas,
  });
  const decidir = (bruto: unknown) =>
    cotacaoCacheadaQueAindaServe(bruto, ASSINATURA, agora, contexto);

  it("controle: envelope válido devolve as opções", () => {
    expect(decidir(envelope())).toEqual([OPCAO]);
  });

  it.each([
    ["opcoes: lista vazia", { opcoes: [] }],
    ["opcoes: texto (não é lista)", { opcoes: "melhorenvio-pac" }],
    ["opcoes: objeto (não é lista)", { opcoes: { 0: OPCAO } }],
    ["opcoes: null", { opcoes: null }],
    ["opcoes: ausente", { opcoes: undefined }],
  ])("não serve: %s", (_nome, sobrescritas) => {
    expect(decidir(envelope(sobrescritas))).toBeNull();
  });

  it.each([
    ["gravadoEm: ausente", { gravadoEm: undefined }],
    ["gravadoEm: texto", { gravadoEm: String(agora - 60_000) }],
    ["gravadoEm: null", { gravadoEm: null }],
    ["gravadoEm: NaN", { gravadoEm: Number.NaN }],
    ["gravadoEm: Infinity", { gravadoEm: Number.POSITIVE_INFINITY }],
    ["gravadoEm: agora + 1 hora", { gravadoEm: agora + UMA_HORA_MS }],
    ["gravadoEm: agora + 1 ano", { gravadoEm: agora + UM_ANO_MS }],
  ])("não serve: %s", (_nome, sobrescritas) => {
    expect(decidir(envelope(sobrescritas))).toBeNull();
  });
});

describe("ShippingCalculator com envelope vazio ou sem data válida no localStorage", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let selecionada: ShippingOption | null;
  let opcoesDaEdge: ShippingOption[];
  let relogio: ReturnType<typeof vi.spyOn> | null;

  const envelopeSemeado = (sobrescritas: Record<string, unknown> = {}) =>
    JSON.stringify({
      contexto: contextoDaLojaParaFrete(LOJA_SF),
      assinatura: ASSINATURA,
      gravadoEm: Date.now() - 60_000,
      revisaoConfig: REVISAO_FIXA_DO_TESTE,
      opcoes: [OPCAO],
      ...sobrescritas,
    });

  /** Chamadas que foram COTAÇÃO (têm `cart`) — a confirmação da revisão não conta. */
  const cotacoes = () =>
    invoke.mock.calls.filter(
      (c) => (c[1] as CorpoDaChamada).body?.cart !== undefined,
    );
  const confirmacoesDeRevisao = () =>
    invoke.mock.calls.filter(
      (c) => (c[1] as CorpoDaChamada).body?.action === "revisao_config_frete",
    );

  beforeEach(() => {
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    opcoesDaEdge = [OPCAO];
    relogio = null;
    invoke.mockReset();
    invoke.mockImplementation((_nome: string, opts: CorpoDaChamada) => {
      if (opts?.body?.action === "revisao_config_frete") {
        return Promise.resolve({
          data: { revisaoConfig: REVISAO_FIXA_DO_TESTE },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          options: opcoesDaEdge,
          cotacaoIncompleta: false,
          revisaoConfig: REVISAO_FIXA_DO_TESTE,
        },
        error: null,
      });
    });
    selecionada = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    relogio?.mockRestore();
    vi.unstubAllGlobals();
  });

  async function pintar() {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ContextoDoFreteDaLoja.Provider
          value={contextoDaLojaParaFrete(LOJA_SF)}
        >
          <ShippingCalculator
            cart={CARRINHO}
            selectedOption={null}
            onSelectOption={(opcao) => {
              selecionada = opcao;
            }}
            cepDestino={CEP}
          />
        </ContextoDoFreteDaLoja.Provider>,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  async function remontar() {
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await pintar();
  }

  it("controle: envelope válido (1 opção) é servido — só a confirmação da revisão, nenhuma cotação", async () => {
    armazem.set(chaveDoCacheDeFrete(CEP), envelopeSemeado());
    await pintar();

    expect(cotacoes()).toHaveLength(0);
    expect(confirmacoesDeRevisao()).toHaveLength(1);
    expect(selecionada?.id).toBe("superfrete-17");
  });

  it("envelope com opcoes VAZIA e a edge ainda sem opção: cota na rede UMA vez e mostra 'A calcular: nenhuma opção de entrega'", async () => {
    armazem.set(chaveDoCacheDeFrete(CEP), envelopeSemeado({ opcoes: [] }));
    opcoesDaEdge = [];
    await pintar();

    expect(cotacoes()).toHaveLength(1);
    expect(confirmacoesDeRevisao()).toHaveLength(0);
    expect(hospedeiro.textContent).toContain(
      "A calcular: nenhuma opção de entrega",
    );
  });

  it("envelope com opcoes VAZIA e a lojista já conectou a transportadora: a opção nova aparece e é auto-selecionada", async () => {
    armazem.set(chaveDoCacheDeFrete(CEP), envelopeSemeado({ opcoes: [] }));
    opcoesDaEdge = [OPCAO];
    await pintar();

    expect(cotacoes()).toHaveLength(1);
    expect(hospedeiro.textContent).not.toContain("A calcular: nenhuma opção");
    expect(hospedeiro.textContent).toContain("19,01");
    expect(selecionada?.id).toBe("superfrete-17");
  });

  it("envelope SEM gravadoEm não vale como fresco: cota na rede", async () => {
    armazem.set(
      chaveDoCacheDeFrete(CEP),
      envelopeSemeado({ gravadoEm: undefined }),
    );
    await pintar();

    expect(cotacoes()).toHaveLength(1);
    expect(confirmacoesDeRevisao()).toHaveLength(0);
  });

  it("envelope com gravadoEm em TEXTO não vale como fresco: cota na rede", async () => {
    armazem.set(
      chaveDoCacheDeFrete(CEP),
      envelopeSemeado({ gravadoEm: String(Date.now() - 60_000) }),
    );
    await pintar();

    expect(cotacoes()).toHaveLength(1);
    expect(confirmacoesDeRevisao()).toHaveLength(0);
  });

  it("relógio do aparelho andou para trás depois de gravar o cache: a cotação gravada 'no futuro' não é servida, recota na rede", async () => {
    // 1ª rodada: sem cache, cota na rede e GRAVA o envelope com a hora de agora.
    await pintar();
    expect(cotacoes()).toHaveLength(1);
    expect(armazem.has(chaveDoCacheDeFrete(CEP))).toBe(true);

    // O relógio volta 1 hora (só `Date.now`; os timers seguem reais): para o
    // componente, o envelope foi gravado daqui a 1 hora — idade negativa.
    const noPassado = Date.now() - UMA_HORA_MS;
    relogio = vi.spyOn(Date, "now").mockReturnValue(noPassado);
    await remontar();

    expect(cotacoes()).toHaveLength(2);
    expect(confirmacoesDeRevisao()).toHaveLength(0);
  });
});
