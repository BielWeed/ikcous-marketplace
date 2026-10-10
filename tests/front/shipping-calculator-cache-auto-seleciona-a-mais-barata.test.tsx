// @vitest-environment jsdom
//
// O ramo da RESPOSTA FRESCA auto-seleciona `opcaoMaisBarata` (laudo 31/08,
// menor E) desde que a `ShippingCalculator` parou de travar o cliente na
// opção cara. O ramo do ACERTO DE CACHE do navegador ficou para trás: ele
// continua com `opcoesEmCache[0]` — a ordem em que a transportadora (Melhor
// Envio) devolveu as opções na cotação original, que não é por preço.
//
// Reprodução: cliente cota o CEP e recebe [Expressa R$ 45, Econômica R$ 22]
// nessa ordem. Ele sai e volta ao carrinho (ou recarrega a página) dentro
// das 2h de validade do cache local — a segunda visita lê o ENVELOPE já
// gravado (ver `cotacaoCacheadaQueAindaServe` em ShippingCalculator.tsx) e
// seleciona o índice 0, que é a opção CARA. O cliente que não reparar paga
// R$ 23 a mais.
import { contextoDaLojaParaFrete } from "@/contexts/ContextoDoFreteDaLoja";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
// FRETE V2 (onda D-1, 03/09): fonte única de `freteGratis` é o CartContext —
// mock seco, nenhum cenário deste arquivo é grátis.
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
// FRETE V3 (T3, 23/09/2026): ShippingCalculator deixou de ler `freteGratis`
// do CartContext (a cópia global morreu — cada cartão calcula o preço
// FINAL da própria modalidade) e passou a ler `config` de `useStore()`
// diretamente, mesmo padrão de CartReminder/FreeShippingBlock.
// `freeShippingMin: 0` = preset "desligado" -- os ids destes cenários não
// dependem da regra local (nacional nunca a usa; local, quando aparece,
// não é o alvo do teste).
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

function produto(): Product {
  return {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 50,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

function carrinhoComQuantidade(quantidade: number): CartItem[] {
  return [{ product: produto(), quantity: quantidade }];
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — o acerto de cache do navegador auto-seleciona a MAIS BARATA, não a primeira", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  const onSelectOption = vi.fn();

  let cepDestinoAtual: string | null = null;
  let ultimoCarrinho: CartItem[] = [];

  beforeEach(() => {
    cepDestinoAtual = null;
    ultimoCarrinho = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00Z"));
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
    invoke.mockReset();
    onSelectOption.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function pintar(cart: CartItem[]) {
    ultimoCarrinho = cart;
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={cart}
          selectedOption={null}
          onSelectOption={onSelectOption}
          cepDestino={cepDestinoAtual}
        />,
      );
    });
  }

  // Frete automático (22/09/2026): não há mais campo de CEP nem botão
  // "Calcular". O destino chega como `cepDestino` (o endereço de entrega
  // escolhido) e a TROCA de destino cota na hora — é o equivalente exato do
  // antigo "digitar o CEP e enviar".
  async function digitarCep(valor: string) {
    cepDestinoAtual = valor;
    await pintar(ultimoCarrinho);
  }

  async function enviar() {
    // Sem botão: só escoa as respostas já resolvidas da cotação automática.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("acerto de cache seleciona a opção mais barata, não `opcoesEmCache[0]`", async () => {
    // R1-2 (release 1.5.7): antes de servir o cache, a calculadora confirma
    // a revisão da config numa ação pública separada — o dublê responde ela
    // com a MESMA revisão gravada no envelope, senão o cache nunca serviria
    // e este teste não provaria a auto-seleção que ele existe para provar.
    const REVISAO = "rev-fixa";
    invoke.mockImplementation((_nome: string, opts: any) => {
      if (opts?.body?.action === "revisao_config_frete") {
        return Promise.resolve({
          data: { revisaoConfig: REVISAO },
          error: null,
        });
      }
      return Promise.resolve({ data: { options: [] }, error: null });
    });

    // Envelope já gravado por uma consulta anterior: a transportadora
    // devolveu a Expressa (cara) em primeiro e a Econômica (barata) em
    // segundo — ordem do provedor, não de preço.
    // Chave v2 + contexto (release 1.5.3): sem StoreProvider na montagem, o
    // contexto do frete é o padrão "sem config".
    armazem.set(
      "ikcous_shipping_cache_v2_69000000",
      JSON.stringify({
        contexto: contextoDaLojaParaFrete(undefined),
        assinatura: "prod-1::1",
        gravadoEm: Date.now(),
        revisaoConfig: REVISAO,
        opcoes: [
          {
            id: "expressa",
            name: "Entrega expressa",
            price: 45,
            deliveryDays: 2,
          },
          {
            id: "economica",
            name: "Entrega econômica",
            price: 22,
            deliveryDays: 7,
          },
        ],
      }),
    );

    await pintar(carrinhoComQuantidade(1));
    await digitarCep("69000000");
    await enviar();

    // Acerto de cache: nenhuma chamada de COTAÇÃO à edge function — só a
    // confirmação da revisão (R1-2), que não cota nada.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("calculate-shipping", {
      body: { action: "revisao_config_frete" },
    });

    // A auto-seleção tem que escolher a barata (R$ 22), nunca a primeira da
    // lista (R$ 45) — mesma regra que o ramo da resposta fresca já aplica
    // via `opcaoMaisBarata`.
    expect(onSelectOption).toHaveBeenCalledTimes(1);
    // Escolha feita pela regra da casa: origem `automatica` (nunca
    // `cliente`) — é o que deixa a próxima cotação refazê-la.
    expect(onSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({ id: "economica", price: 22 }),
      "automatica",
    );
  });
});
