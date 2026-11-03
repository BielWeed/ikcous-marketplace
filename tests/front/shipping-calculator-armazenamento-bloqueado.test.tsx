// @vitest-environment jsdom
//
// ARMAZENAMENTO DO NAVEGADOR BLOQUEADO NÃO DERRUBA O FRETE (caça, achado c0).
//
// Navegador com "bloquear dados de sites" faz localStorage.getItem/removeItem
// lançarem SecurityError. A gravação do cache já era protegida
// (`gravarNoCache`), mas a LEITURA ficava dentro do try da cotação (o catch
// zerava as opções e mostrava erro, sem nunca chamar a edge) e a REMOÇÃO
// ficava solta em useEffect (exceção em efeito sobe ao error boundary).
// O cache é só um atalho: sem armazenamento, a cotação segue pela rede.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, ShippingOption } from "@/types";

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

function produto(): Product {
  return {
    id: "prod-bloqueado",
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
const carrinho = (quantidade: number): CartItem[] => [
  { product: produto(), quantity: quantidade },
];

const PAC: ShippingOption = {
  id: "melhorenvio-pac",
  name: "PAC",
  price: 41.9,
  deliveryDays: 7,
  provider: "melhor_envio",
};

const bloqueado = () => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

describe("ShippingCalculator com o armazenamento bloqueado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let selecionadas: Array<ShippingOption | null>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", {
      getItem: bloqueado,
      setItem: bloqueado,
      removeItem: bloqueado,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { options: [PAC] }, error: null });
    selecionadas = [];
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
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function montar(cart: CartItem[]) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={cart}
          selectedOption={null}
          onSelectOption={(opcao) => selecionadas.push(opcao)}
          cepDestino={CEP}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  it("leitura bloqueada: a cotação segue pela rede, com a opção escolhida", async () => {
    await montar(carrinho(1));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(selecionadas.at(-1)?.id).toBe("melhorenvio-pac");
    expect(hospedeiro.textContent).not.toContain("Não foi possível calcular");
    expect(hospedeiro.textContent).toContain("41,90");
  });

  it("remoção bloqueada: mudar a quantidade não derruba a tela e recota", async () => {
    await montar(carrinho(1));
    expect(invoke).toHaveBeenCalledTimes(1);

    await montar(carrinho(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain("41,90");
  });
});
