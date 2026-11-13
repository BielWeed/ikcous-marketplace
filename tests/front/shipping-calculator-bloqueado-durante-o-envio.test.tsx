// @vitest-environment jsdom
//
// CHECKOUT = DINHEIRO (13/11/2026): com o pedido sendo enviado, a cliente podia
// tocar em "Trocar" e escolher OUTRA modalidade (entrega -> retirada). A tela
// passava a mostrar a retirada, mas o envio seguia com a modalidade e o frete
// capturados no clique de "Finalizar" — o pedido nascia com R$ 10 de entrega
// numa tela que dizia "retirada, sem frete".
//
// A calculadora ganhou a prop `bloqueado` (o checkout passa `isSubmitting`):
// com ela ligada, o "Trocar", os cartões de opção e o "Tentar de novo" ficam
// desabilitados e o clique NÃO chega ao `onSelectOption`. Fora do envio,
// tudo continua clicável como sempre.
//
// Mesmo harness de shipping-calculator-modo-resumo.test.tsx.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrigemDaEscolhaDoFrete } from "@/lib/auto-selecao-de-frete";
import type { CartItem, Product, ShippingOption } from "@/types";

const invoke = vi.fn();
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

function produto(): Product {
  return {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 50,
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

const PAC: ShippingOption = {
  id: "melhor-envio-1",
  name: "Entrega econômica",
  price: 26.41,
  deliveryDays: 8,
  provider: "melhor_envio",
  transportadora: "Correios",
  servico: "PAC",
  provedorRotulo: "Melhor Envio",
};
const SEDEX: ShippingOption = {
  id: "melhor-envio-2",
  name: "Entrega expressa",
  price: 54.88,
  deliveryDays: 4,
  provider: "melhor_envio",
  transportadora: "Correios",
  servico: "SEDEX",
  provedorRotulo: "Melhor Envio",
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — bloqueado enquanto o pedido está sendo enviado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  const aoEscolher =
    vi.fn<
      (opcao: ShippingOption | null, origem?: OrigemDaEscolhaDoFrete) => void
    >();
  const pai = {
    selecionada: null as ShippingOption | null,
    ligarBloqueio: (_valor: boolean) => {},
  };

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
      data: { options: [PAC, SEDEX], cotacaoIncompleta: false },
      error: null,
    });
    aoEscolher.mockReset();
    pai.selecionada = null;
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

  async function drenar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  async function montar({
    modoResumo = true,
    bloqueado,
  }: { modoResumo?: boolean; bloqueado?: boolean | "sem-prop" } = {}) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    function PaiDeEstadoReal() {
      const [itens] = useState<CartItem[]>([
        { product: produto(), quantity: 1 },
      ]);
      const [selecionada, setSelecionada] = useState<ShippingOption | null>(
        null,
      );
      const [cepDaSelecao, setCepDaSelecao] = useState<string | null>(null);
      const [travado, setTravado] = useState(bloqueado === true);
      pai.selecionada = selecionada;
      pai.ligarBloqueio = setTravado;
      return (
        <ShippingCalculator
          cart={itens}
          selectedOption={selecionada}
          onSelectOption={(opcao, origem) => {
            aoEscolher(opcao, origem);
            setSelecionada(opcao);
          }}
          cepDestino="38500000"
          cepDaSelecao={cepDaSelecao}
          onCepValidated={setCepDaSelecao}
          modoResumo={modoResumo}
          {...(bloqueado === "sem-prop" ? {} : { bloqueado: travado })}
        />
      );
    }
    await act(async () => {
      raiz.render(<PaiDeEstadoReal />);
    });
    await drenar();
  }

  function botaoDe(nome: string) {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(nome),
    );
  }

  async function ligarBloqueio(valor: boolean) {
    await act(async () => {
      pai.ligarBloqueio(valor);
    });
  }

  it("com envio em curso o 'Trocar' fica desabilitado (disabled + aria-disabled) e o clique não abre a lista", async () => {
    await montar({ bloqueado: true });
    expect(pai.selecionada?.id).toBe("melhor-envio-1");
    aoEscolher.mockClear();

    const trocar = botaoDe("Trocar") as HTMLButtonElement;
    expect(trocar).toBeDefined();
    expect(trocar.disabled).toBe(true);
    expect(trocar.getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      trocar.click();
    });
    // A lista não abriu: as opções seguem escondidas atrás do resumo.
    expect(botaoDe("Entrega expressa")).toBeUndefined();
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("lista JÁ aberta quando o envio começa: os cartões travam e o clique NÃO chama onSelectOption (a seleção não muda)", async () => {
    await montar({ bloqueado: false });
    await act(async () => {
      botaoDe("Trocar")?.click();
    });
    expect(botaoDe("Entrega expressa")).toBeDefined();
    aoEscolher.mockClear();

    await ligarBloqueio(true);

    const expressa = botaoDe("Entrega expressa") as HTMLButtonElement;
    expect(expressa.disabled).toBe(true);
    expect(expressa.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      expressa.click();
    });
    expect(aoEscolher).not.toHaveBeenCalled();
    expect(pai.selecionada?.id).toBe("melhor-envio-1");
  });

  it("fora do envio continua clicável: Trocar abre a lista e escolher chama onSelectOption com origem 'cliente'", async () => {
    await montar({ bloqueado: false });
    aoEscolher.mockClear();

    const trocar = botaoDe("Trocar") as HTMLButtonElement;
    expect(trocar.disabled).toBe(false);
    expect(trocar.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => {
      trocar.click();
    });
    await act(async () => {
      botaoDe("Entrega expressa")?.click();
    });
    expect(aoEscolher).toHaveBeenCalledTimes(1);
    expect(aoEscolher).toHaveBeenCalledWith(
      expect.objectContaining({ id: "melhor-envio-2" }),
      "cliente",
    );
    expect(pai.selecionada?.id).toBe("melhor-envio-2");
  });

  it("sem a prop (o carrinho, que nunca envia pedido por aqui): tudo clicável como antes", async () => {
    await montar({ bloqueado: "sem-prop" });
    aoEscolher.mockClear();
    await act(async () => {
      botaoDe("Trocar")?.click();
    });
    await act(async () => {
      botaoDe("Entrega expressa")?.click();
    });
    expect(pai.selecionada?.id).toBe("melhor-envio-2");
  });

  it("o bloqueio SOLTA quando o envio termina sem pedido (recusa/erro): a cliente volta a poder trocar", async () => {
    await montar({ bloqueado: true });
    const trocar = () => botaoDe("Trocar") as HTMLButtonElement;
    expect(trocar().disabled).toBe(true);

    await ligarBloqueio(false);
    expect(trocar().disabled).toBe(false);
    await act(async () => {
      trocar().click();
    });
    await act(async () => {
      botaoDe("Entrega expressa")?.click();
    });
    expect(pai.selecionada?.id).toBe("melhor-envio-2");
  });

  it("lista sem modoResumo (carrinho) com bloqueado: os cartões também travam", async () => {
    await montar({ modoResumo: false, bloqueado: true });
    aoEscolher.mockClear();
    const expressa = botaoDe("Entrega expressa") as HTMLButtonElement;
    expect(expressa.disabled).toBe(true);
    await act(async () => {
      expressa.click();
    });
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("'Tentar de novo' (que recota e pode trocar a seleção sozinha) também trava durante o envio", async () => {
    invoke.mockReset();
    invoke.mockRejectedValue(new Error("Falha ao cotar frete."));
    await montar({ bloqueado: true });
    const tentar = botaoDe("Tentar de novo") as HTMLButtonElement;
    expect(tentar).toBeDefined();
    expect(tentar.disabled).toBe(true);
  });
});
