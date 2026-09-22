// @vitest-environment jsdom
//
// D1 do frete divergente (bug 07095-005 → 38500-000): a calculadora do
// carrinho semeava o CEP SÓ do `ikcous_last_shipping_cep` — sobra de uma
// simulação antiga — enquanto a entrega ia para o endereço cadastrado.
// Regra do dono: o CEP vem do endereço de entrega (principal no início, ou o
// escolhido no fluxo), inclusive quando a lista de endereços chega DEPOIS da
// montagem. Frete automático (22/09/2026): não existe mais campo de CEP nem
// simulação manual — o destino é SÓ o endereço. A TROCA do destino derruba a
// escolha antiga na hora, cancela resposta pendente e recota; montar de novo
// no MESMO destino preserva a modalidade com o preço fresco.
//
// Segue o padrão de shipping-calculator-selecao-fresca-mesmo-id.test.tsx.
import { act } from "react";
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

const ECO_ANTIGO: ShippingOption = {
  id: "eco",
  name: "Econômico",
  price: 26.41,
  deliveryDays: 8,
  provider: "melhor_envio",
};
const ECO_DESTINO: ShippingOption = {
  id: "eco",
  name: "Econômico",
  price: 12.34,
  deliveryDays: 4,
  provider: "melhor_envio",
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — o destino da cotação é o endereço de entrega efetivo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let selecionada: { current: ShippingOption | null };
  // Espelho do destino derivado do endereço cadastrado (chega async: a
  // lista de endereços demora mais que a montagem do carrinho).
  let cepDestino: { current: string | null };
  // `shippingCep` do CartContext: o CEP para o qual a escolha foi cotada.
  let cepDaSelecao: { current: string | null };

  beforeEach(() => {
    vi.useFakeTimers();
    armazem = new Map<string, string>();
    // A sobra da simulação antiga — é EXATAMENTE ela que não pode governar
    // o frete de quem tem endereço cadastrado.
    armazem.set("ikcous_last_shipping_cep", "07095-005");
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
      data: { options: [ECO_DESTINO] },
      error: null,
    });
    selecionada = { current: null };
    cepDestino = { current: null };
    cepDaSelecao = { current: null };
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

  function textoDaTela(): string {
    return hospedeiro.textContent ?? "";
  }

  async function renderizar(cart: CartItem[] = carrinho()) {
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
          onCepValidated={(cep) => {
            cepDaSelecao.current = cep;
          }}
          cepDestino={cepDestino.current}
          cepDaSelecao={cepDaSelecao.current}
        />,
      );
    });
  }

  /** O CartContext aplicou o estado e o pai re-renderizou com a prop nova. */
  const sincronizarPai = renderizar;

  async function escoarMicrotasks() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  function cepDaCotacao(chamada: unknown[]): string {
    return (chamada[1] as { body: { cep: string } }).body.cep;
  }

  it("o DEFEITO: endereço 38500-000 chega assíncrono — a sobra 07095-005 do localStorage nunca vira destino, a escolha antiga cai e o frete é cotado para o endereço", async () => {
    // O contexto ainda carrega a escolha feita para o CEP antigo.
    selecionada.current = ECO_ANTIGO;
    cepDaSelecao.current = "07095-005";
    await renderizar();
    // Sem endereço ainda: nada é cotado, e a sobra da simulação antiga não
    // aparece como destino (não há mais campo de CEP para semear).
    expect(invoke).not.toHaveBeenCalled();
    expect(textoDaTela()).not.toContain("07095");
    expect(textoDaTela()).toContain("Cadastre um endereço");

    // A lista de endereços chega: o principal é 38500-000.
    let resolver!: (valor: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    cepDestino.current = "38500-000";
    await sincronizarPai();

    // A cotação nova saiu sozinha (sem clique) para o destino.
    expect(textoDaTela()).toContain("CEP 38500-000");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(cepDaCotacao(invoke.mock.calls[0])).toBe("38500000");
    // A escolha feita para 07095-005 não pode governar o destino novo.
    expect(selecionada.current).toBeNull();

    await act(async () => {
      resolver({ data: { options: [ECO_DESTINO] }, error: null });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(selecionada.current?.price).toBe(12.34);
    expect(cepDaSelecao.current).toBe("38500-000");
    expect(armazem.get("ikcous_last_shipping_cep")).toBe("38500-000");
  });

  it("montar de novo no MESMO destino (voltar ao carrinho) preserva a modalidade com preço fresco; TROCAR de destino derruba a escolha na hora e recota", async () => {
    // A cliente escolheu "Econômico" para 38500-000 (preço daquela rodada).
    selecionada.current = ECO_ANTIGO;
    cepDaSelecao.current = "38500-000";
    cepDestino.current = "38500-000";

    let resolver!: (valor: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    await renderizar();
    // A escolha é deste destino: NÃO cai enquanto a recotação está em voo.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(selecionada.current?.id).toBe("eco");
    await act(async () => {
      resolver({ data: { options: [ECO_DESTINO] }, error: null });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    // Mesma modalidade, objeto FRESCO (preço da cotação nova).
    expect(selecionada.current).toEqual(ECO_DESTINO);
    await sincronizarPai();

    // O destino TROCA (escolheu outro endereço): a escolha cai NA HORA,
    // antes de a cotação nova voltar, e o frete é recotado.
    let resolverNovo!: (valor: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolverNovo = resolve;
        }),
    );
    cepDestino.current = "12345-678";
    await sincronizarPai();
    expect(selecionada.current).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(cepDaCotacao(invoke.mock.calls[1])).toBe("12345678");
    // Nada do destino anterior continua clicável.
    expect(hospedeiro.querySelector("button[aria-pressed]")).toBeNull();

    await act(async () => {
      resolverNovo({
        data: { options: [{ ...ECO_DESTINO, price: 55 }] },
        error: null,
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    await escoarMicrotasks();
    expect(selecionada.current?.price).toBe(55);
    expect(cepDaSelecao.current).toBe("12345-678");
  });

  it("troca de destino com resposta atrasada: vale a cotação do destino MAIS RECENTE, a atrasada é descartada", async () => {
    await renderizar();

    let resolver38500!: (valor: unknown) => void;
    let resolver12345!: (valor: unknown) => void;
    let ordem = 0;
    invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          ordem += 1;
          if (ordem === 1) {
            resolver38500 = resolve;
          } else {
            resolver12345 = resolve;
          }
        }),
    );

    cepDestino.current = "38500-000";
    await sincronizarPai();
    cepDestino.current = "12345-678";
    await sincronizarPai();
    expect(invoke).toHaveBeenCalledTimes(2);
    // FORA DE ORDEM de verdade: a resposta do destino MAIS RECENTE (12345)
    // chega primeiro; a do intermediário (38500) só chega depois — e tem de
    // ser descartada pelo lacre de sequência.
    await act(async () => {
      resolver12345?.({
        data: { options: [{ ...ECO_DESTINO, price: 10 }] },
        error: null,
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(selecionada.current?.price).toBe(10);

    await act(async () => {
      resolver38500?.({
        data: { options: [{ ...ECO_DESTINO, price: 99 }] },
        error: null,
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    expect(selecionada.current?.price).toBe(10);
    expect(textoDaTela()).toContain("CEP 12345-678");
    expect(armazem.get("ikcous_last_shipping_cep")).toBe("12345-678");
  });

  it("sem endereço de entrega: nada é cotado, nenhum preço aparece e a tela pede o cadastro", async () => {
    await renderizar();
    await escoarMicrotasks();

    expect(invoke).not.toHaveBeenCalled();
    expect(selecionada.current).toBeNull();
    expect(textoDaTela()).not.toContain("R$");
    expect(textoDaTela()).toContain("Cadastre um endereço");
  });

  it("o endereço SOME (removido): a cotação e a escolha daquele destino caem", async () => {
    cepDestino.current = "38500-000";
    await renderizar();
    await escoarMicrotasks();
    await sincronizarPai();
    expect(selecionada.current?.price).toBe(12.34);
    expect(textoDaTela()).toContain("12,34");

    cepDestino.current = null;
    await sincronizarPai();

    expect(selecionada.current).toBeNull();
    expect(textoDaTela()).not.toContain("12,34");
    expect(textoDaTela()).toContain("Cadastre um endereço");
  });

  it("resposta atrasada depois do desmonte não grava CEP nem cache de frete", async () => {
    await renderizar();

    let resolver!: (valor: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    cepDestino.current = "38500-000";
    await sincronizarPai();
    expect(invoke).toHaveBeenCalledTimes(1);

    // Saiu do carrinho com a cotação em voo (foi para o checkout).
    await act(async () => {
      raiz.unmount();
    });
    await act(async () => {
      resolver({ data: { options: [ECO_DESTINO] }, error: null });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    // Nada pousou no navegador: nem o CEP antigo gravado de novo, nem o
    // cache do destino — a resposta morreu com o componente.
    expect(armazem.get("ikcous_last_shipping_cep")).toBe("07095-005");
    expect(armazem.has("ikcous_shipping_cache_38500000")).toBe(false);

    // Recria a raiz para o afterEach não desmontar duas vezes.
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
});
