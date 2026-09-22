// @vitest-environment jsdom
//
// D2 do diagnóstico do frete divergente (bug 07095-005 → 38500-000): a
// escolha do frete era comparada SÓ POR ID (`hasMatch`) contra a lista da
// cotação NOVA. Mesmo id = "o cliente já escolheu isto" — mas o OBJETO
// selecionado, que é o que vira preço no pedido, continuava sendo o da
// cotação ANTERIOR: mesma transportadora, CEP e preço de outro destino. A
// lista na tela mostrava o preço novo enquanto o total cobrava o velho.
//
// Os caminhos que fazem a comparação são cobertos aqui:
//   1. RESPOSTA FRESCA — troca o CEP no campo e cota de novo (mesmo
//      carrinho): a resposta traz o mesmo id com preço diferente e a
//      escolha tem de acompanhar o objeto NOVO.
//   2. CACHE — cotou A, cotou B, voltou para A: o cache de A (válido, do
//      mesmo carrinho) tem o mesmo id com o preço de A; a escolha que
//      veio de B tem de ser substituída pelo objeto do cache de A.
//   3. CLIQUE EM VOO — recotação pendente e a cliente clica noutra
//      modalidade: a escolha VIVA (prop do último render) é resolvida
//      contra a lista NOVA e sai com o preço fresco dela.
//
// Segue o padrão de shipping-calculator-recota-por-quantidade.test.tsx:
// createRoot + act, dublês secos, localStorage stubado com um Map.
import { act, useEffect, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, ShippingOption } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
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
    price: 128.25,
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

function carrinho(): CartItem[] {
  return [{ product: produto(), quantity: 1 }];
}

const ECO_A: ShippingOption = {
  id: "eco",
  name: "Econômico",
  price: 26.41,
  deliveryDays: 8,
  provider: "melhor_envio",
};
const ECO_B: ShippingOption = {
  id: "eco",
  name: "Econômico",
  price: 19.9,
  deliveryDays: 6,
  provider: "melhor_envio",
};
const SEDEX_A: ShippingOption = {
  id: "sedex",
  name: "Sedex",
  price: 39.9,
  deliveryDays: 2,
  provider: "melhor_envio",
};
const SEDEX_B: ShippingOption = {
  id: "sedex",
  name: "Sedex",
  price: 44.5,
  deliveryDays: 2,
  provider: "melhor_envio",
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — cotação nova com o MESMO id substitui o objeto/preço selecionado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  // Espelho do `selectedShippingOption` do CartContext: o componente pai
  // guarda o objeto que `onSelectOption` entrega e o devolve na prop.
  let selecionada: { current: ShippingOption | null };

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
    invoke.mockResolvedValue({
      data: { options: [ECO_A] },
      error: null,
    });
    selecionada = { current: null };
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

  async function renderizar(cart: CartItem[]) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={cart}
          selectedOption={selecionada.current}
          onSelectOption={(opt) => {
            selecionada.current = opt;
          }}
        />,
      );
    });
  }

  // O `onSelectOption` do dublê só grava o objeto; o re-render com a prop
  // `selectedOption` atualizada é o que o CartContext de verdade faz ao
  // mudar de estado. Sem este passo, a prop ficaria `null` e o `hasMatch`
  // (que compara a seleção anterior pela prop) nunca seria exercitado —
  // o teste passaria sem provar nada.
  async function sincronizarPai(cart: CartItem[]) {
    await renderizar(cart);
  }

  // Espelho do estado do pai DE VERDADE (useState): `selecionada` e o
  // carrinho vivem em estado React, e o re-render após o clique é o que o
  // CartContext faz — é essa prop atualizada que a seleção viva precisa
  // enxergar na hora em que a resposta em voo pousa.
  const pai = {
    selecionada: null as ShippingOption | null,
    alterarCarrinho: (_itens: CartItem[]) => {},
  };

  async function renderizarPaiComEstadoReal() {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    function PaiDeEstadoReal() {
      const [itens, setItens] = useState<CartItem[]>(carrinho());
      const [selecionada, setSelecionada] = useState<ShippingOption | null>(
        null,
      );
      // Espelho em efeito — o render é imutável (react-hooks/immutability).
      useEffect(() => {
        pai.selecionada = selecionada;
        pai.alterarCarrinho = setItens;
      }, [selecionada]);
      return (
        <ShippingCalculator
          cart={itens}
          selectedOption={selecionada}
          onSelectOption={setSelecionada}
        />
      );
    }
    await act(async () => {
      raiz.render(<PaiDeEstadoReal />);
    });
  }

  async function clicarOpcao(nome: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(nome),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
    });
  }

  /** Digita um CEP no campo e envia o formulário (cotação imediata). */
  async function cotar(cep: string) {
    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, cep);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const formulario = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      // A cadeia do calculateShipping (invoke → setState) precisa de mais
      // microtasks do que duas para o resultado pousar no estado.
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it("RESPOSTA FRESCA: troca o CEP, a resposta traz o mesmo id com preço novo — a escolha passa a valer o preço novo", async () => {
    await renderizar(carrinho());

    await cotar("69000000");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(selecionada.current?.id).toBe("eco");
    expect(selecionada.current?.price).toBe(26.41);
    // O contexto aplicou a escolha: a prop volta atualizada no render
    // seguinte — é ela que o `hasMatch` compara na cotação seguinte.
    await sincronizarPai(carrinho());

    // Mesmo carrinho (assinatura igual — o debounce nem dispara), CEP
    // diferente: o preço do mesmo serviço muda de cidade para cidade.
    invoke.mockResolvedValue({ data: { options: [ECO_B] }, error: null });

    await cotar("12345678");

    expect(invoke).toHaveBeenCalledTimes(2);
    const corpo = invoke.mock.calls[1][1] as { body: { cep: string } };
    expect(corpo.body.cep).toBe("12345678");
    expect(selecionada.current?.id).toBe("eco");
    // 🔴 O DEFEITO: `hasMatch` via id mantinha o objeto de R$ 26,41 (cotação
    // do CEP anterior) como escolha — o total cobrava o preço do CEP velho.
    expect(selecionada.current?.price).toBe(19.9);
  });

  it("CACHE: cotou A, cotou B, voltou para A — o cache válido de A substitui a escolha trazida de B", async () => {
    await renderizar(carrinho());

    // A: cotação fresca grava cache de "69000000" e seleciona R$ 26,41.
    await cotar("69000000");
    expect(selecionada.current?.price).toBe(26.41);
    await sincronizarPai(carrinho());

    // B: cotação fresca de outro CEP — o cache de A continua intacto (a
    // invalidação por mudança de carrinho apaga só a chave do CEP corrente,
    // e trocar o campo não muda a assinatura do carrinho).
    invoke.mockResolvedValue({ data: { options: [ECO_B] }, error: null });
    await cotar("12345678");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(selecionada.current?.price).toBe(19.9);
    await sincronizarPai(carrinho());

    // Voltou para A: HIT de cache (mesma assinatura, dentro da validade) —
    // nenhuma chamada nova à transportadora, e a escolha de B tem de cair
    // pelo objeto fresco do cache de A.
    await cotar("69000000");

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(selecionada.current?.id).toBe("eco");
    // 🔴 O DEFEITO: o mesmo `hasMatch` por id no ramo do cache mantinha o
    // R$ 19,90 de B como escolha para o destino A.
    expect(selecionada.current?.price).toBe(26.41);
    expect(armazem.get("ikcous_last_shipping_cep")).toBe("69000-000");
  });

  it("CLIQUE EM VOO: clique durante a recotação permanece e sai com o preço fresco dele", async () => {
    // Cotação inicial: duas modalidades, a mais barata auto-selecionada.
    invoke.mockResolvedValueOnce({
      data: { options: [ECO_A, SEDEX_A] },
      error: null,
    });
    await renderizarPaiComEstadoReal();

    await cotar("69000000");
    expect(pai.selecionada?.id).toBe("eco");
    expect(pai.selecionada?.price).toBe(26.41);

    // Recotação em voo: muda a quantidade (debounce dispara) com a resposta
    // presa numa promessa controlada.
    const voo: {
      resolver: (valor: { data: unknown; error: unknown }) => void;
    } = { resolver: () => {} };
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          voo.resolver = resolve;
        }),
    );
    await act(async () => {
      pai.alterarCarrinho([{ ...carrinho()[0], quantity: 2 }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledTimes(2);

    // A lista antiga segue na tela; com a recotação pendente, a cliente
    // clica na OUTRA modalidade.
    await clicarOpcao("Sedex");
    expect(pai.selecionada?.id).toBe("sedex");
    expect(pai.selecionada?.price).toBe(39.9);

    // A resposta chega com o preço ATUALIZADO da modalidade clicada.
    await act(async () => {
      voo.resolver({ data: { options: [ECO_B, SEDEX_B] }, error: null });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    // 🔴 O DEFEITO: a resolução usava o `selectedOption` do INÍCIO da
    // cotação (eco) e REVERTIA o clique — de volta ao eco, preço velho.
    expect(pai.selecionada?.id).toBe("sedex");
    expect(pai.selecionada?.price).toBe(44.5);
  });
});
