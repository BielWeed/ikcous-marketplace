// @vitest-environment jsdom
//
// REDE QUE PENDURA NÃO PODE DEIXAR O FRETE GIRANDO PARA SEMPRE.
//
// Rede "pendurada" é a que conecta e não responde (sinal fraco de celular,
// Wi-Fi sem saída). A `supabase.functions.invoke` nunca falha nem termina, e
// a calculadora ficava em "Calculando frete e prazo..." para sempre: o botão
// Finalizar seguia cinza ("Calculando o frete do endereço de entrega...") e o
// "Tentar de novo" só existe no estado de ERRO, que uma chamada pendurada
// nunca alcançava. O mesmo valia para a confirmação da revisão do frete que
// precede o uso do cache.
//
// Com o prazo (`aguardarComPrazo`, o mesmo mecanismo do pedido e da revisão no
// envio), a espera estoura e vira o estado de erro que já existia, com o botão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ShippingCalculator,
  chaveDoCacheDeFrete,
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
const OUTRO_CEP = "69000000";
const LOJA: Partial<StoreConfig> = {
  shippingProvider: "superfrete",
  enabledShippingMethods: ["sedex", "pac"],
  storeAddress: "",
};
const MENSAGEM_DE_CONEXAO_LENTA =
  "A conexão está lenta. Toque em Tentar de novo.";
/** Folga acima do prazo da cotação (15 s) e da revisão (12 s). */
const PRAZO_DA_COTACAO_MS = 15_000;
const PRAZO_DA_REVISAO_MS = 12_000;

function produto(): Product {
  return {
    id: "prod-teste",
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
const ASSINATURA = "prod-teste::1";

const opcao = (id: string, price: number): ShippingOption => ({
  id,
  name: `Entrega ${id}`,
  price,
  deliveryDays: 5,
  provider: "superfrete",
});

const respostaDaCotacao = (...opcoes: ShippingOption[]) => ({
  data: { options: opcoes, revisaoConfig: "rev-1" },
  error: null,
});

describe("ShippingCalculator — chamada pendurada vira erro com 'Tentar de novo'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let escolhas: Array<ShippingOption | null>;

  beforeEach(() => {
    vi.useFakeTimers();
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
    escolhas = [];
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

  const tela = (cep: string) => (
    <ContextoDoFreteDaLoja.Provider value={contextoDaLojaParaFrete(LOJA)}>
      <ShippingCalculator
        cart={CARRINHO}
        selectedOption={null}
        onSelectOption={(o) => {
          escolhas.push(o);
        }}
        cepDestino={cep}
      />
    </ContextoDoFreteDaLoja.Provider>
  );

  async function pintar(cep = CEP) {
    await act(async () => {
      raiz.render(tela(cep));
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  const botaoTentarDeNovo = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Tentar de novo"),
    );

  async function tocarEmTentarDeNovo() {
    const botao = botaoTentarDeNovo();
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  const escolhasReais = () => escolhas.filter((o) => o !== null);

  it("a âncora: antes do prazo ainda calcula, sem erro e sem botão", async () => {
    invoke.mockImplementation(() => new Promise(() => {}));
    await pintar();
    await passar(PRAZO_DA_COTACAO_MS - 1_000);
    expect(hospedeiro.textContent).toContain("Calculando frete e prazo");
    expect(botaoTentarDeNovo()).toBeUndefined();
  });

  it("cotação pendurada: estoura o prazo, mostra o aviso e o botão", async () => {
    invoke.mockImplementation(() => new Promise(() => {}));
    await pintar();
    expect(hospedeiro.textContent).toContain("Calculando frete e prazo");

    await passar(PRAZO_DA_COTACAO_MS + 100);

    expect(hospedeiro.textContent).not.toContain("Calculando frete e prazo");
    expect(hospedeiro.textContent).toContain(MENSAGEM_DE_CONEXAO_LENTA);
    expect(botaoTentarDeNovo()).toBeDefined();
    // Nenhum preço inventado: nada foi escolhido.
    expect(escolhasReais()).toEqual([]);
  });

  it("depois do erro, 'Tentar de novo' com sucesso mostra a cotação normal", async () => {
    invoke.mockImplementationOnce(() => new Promise(() => {}));
    await pintar();
    await passar(PRAZO_DA_COTACAO_MS + 100);
    expect(botaoTentarDeNovo()).toBeDefined();

    invoke.mockResolvedValueOnce(respostaDaCotacao(opcao("pac", 41.9)));
    await tocarEmTentarDeNovo();

    expect(hospedeiro.textContent).not.toContain(MENSAGEM_DE_CONEXAO_LENTA);
    expect(botaoTentarDeNovo()).toBeUndefined();
    expect(escolhasReais()).toHaveLength(1);
    expect(escolhasReais()[0]?.price).toBe(41.9);
  });

  it("resposta tardia da tentativa velha não vira o estado da nova", async () => {
    let soltarAVelha: (v: unknown) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          soltarAVelha = resolve;
        }),
    );
    await pintar();
    await passar(PRAZO_DA_COTACAO_MS + 100);
    expect(botaoTentarDeNovo()).toBeDefined();

    invoke.mockResolvedValueOnce(respostaDaCotacao(opcao("nova", 30)));
    await tocarEmTentarDeNovo();
    expect(escolhasReais().map((o) => o?.price)).toEqual([30]);

    // A tentativa que ficou pendurada responde por último, com outro preço.
    await act(async () => {
      soltarAVelha(respostaDaCotacao(opcao("velha", 10)));
    });
    await passar(PRAZO_DA_COTACAO_MS);

    expect(escolhasReais().map((o) => o?.price)).toEqual([30]);
    expect(hospedeiro.textContent).toContain("Entrega nova");
    expect(hospedeiro.textContent).not.toContain("Entrega velha");
    expect(hospedeiro.textContent).not.toContain(MENSAGEM_DE_CONEXAO_LENTA);
  });

  it("o prazo da tentativa velha estourando não derruba o resultado da mais nova", async () => {
    // Tentativa 1 pendurada para o CEP A; aos 5 s a cliente troca de
    // endereço (CEP B) e a tentativa 2 responde bem. Quando o prazo da 1 vence,
    // o lacre de sequência a descarta: nada de erro por cima da cotação boa.
    invoke
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(respostaDaCotacao(opcao("do-endereco-novo", 22)));
    await pintar(CEP);
    await passar(5_000);
    await pintar(OUTRO_CEP);
    expect(escolhasReais().map((o) => o?.price)).toEqual([22]);

    await passar(PRAZO_DA_COTACAO_MS);

    expect(hospedeiro.textContent).not.toContain(MENSAGEM_DE_CONEXAO_LENTA);
    expect(botaoTentarDeNovo()).toBeUndefined();
    expect(hospedeiro.textContent).toContain("Entrega do-endereco-novo");
  });

  it("revisão da config pendurada (com cotação em cache): estoura o prazo e vira erro", async () => {
    armazem.set(
      chaveDoCacheDeFrete(CEP),
      JSON.stringify({
        contexto: contextoDaLojaParaFrete(LOJA),
        assinatura: ASSINATURA,
        gravadoEm: Date.now() - 60_000,
        revisaoConfig: "rev-1",
        opcoes: [opcao("em-cache", 19)],
      }),
    );
    // Só a pergunta da revisão pendura; qualquer cotação responderia.
    invoke.mockImplementation((_nome: string, opts: any) =>
      opts?.body?.action === "revisao_config_frete"
        ? new Promise(() => {})
        : Promise.resolve(respostaDaCotacao(opcao("da-rede", 25))),
    );
    await pintar();
    expect(hospedeiro.textContent).toContain("Calculando frete e prazo");

    await passar(PRAZO_DA_REVISAO_MS + 100);

    expect(hospedeiro.textContent).not.toContain("Calculando frete e prazo");
    expect(hospedeiro.textContent).toContain(MENSAGEM_DE_CONEXAO_LENTA);
    expect(botaoTentarDeNovo()).toBeDefined();
    // O preço do cache não foi servido sem confirmar a revisão.
    expect(escolhasReais()).toEqual([]);
  });
});
