// @vitest-environment jsdom
//
// CEP válido, cotação concluída SEM erro e SEM nenhuma opção de entrega: a
// cliente lia "combine a entrega com a loja" e não tinha COMO combinar. Agora,
// se a loja tem WhatsApp cadastrado (mesma régua `lojaTemWhatsapp` do
// checkout), aparece "Combinar entrega pelo WhatsApp" — abre o wa.me da loja
// (DDI 55 para número de 10/11 dígitos, sem opener) com o CEP dela. Sem
// WhatsApp o texto segue como era, sem botão. Com opção de entrega, nada novo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShippingCalculator } from "@/components/ui/custom/ShippingCalculator";
import {
  ContextoDoFreteDaLoja,
  contextoDaLojaParaFrete,
} from "@/contexts/ContextoDoFreteDaLoja";
import type { CartItem, Product, ShippingOption, StoreConfig } from "@/types";

const { invoke, lojaAtual } = vi.hoisted(() => ({
  invoke: vi.fn(),
  lojaAtual: { whatsappNumber: "" as string | undefined },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { freeShippingMin: 0, whatsappNumber: lojaAtual.whatsappNumber },
    isLoaded: true,
  }),
}));
// O hook devolve "está offline?" — `false` = com internet.
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
const OPCAO: ShippingOption = {
  id: "superfrete-17",
  name: "Entrega econômica",
  price: 19.01,
  deliveryDays: 11,
  provider: "superfrete",
};
const PRODUTO: Product = {
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
const CARRINHO: CartItem[] = [{ product: PRODUTO, quantity: 1 }];
const TEXTO_SEM_OPCAO = "A calcular: nenhuma opção de entrega";
const ROTULO = "Combinar entrega pelo WhatsApp";

describe("ShippingCalculator — sem opção de entrega, a cliente chama a loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let opcoesDaEdge: ShippingOption[];
  let abrir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    abrir = vi.fn();
    vi.stubGlobal("open", abrir);
    lojaAtual.whatsappNumber = "";
    opcoesDaEdge = [];
    invoke.mockReset();
    invoke.mockImplementation((_nome: string, opts: { body?: unknown }) => {
      const corpo = opts?.body as { action?: string } | undefined;
      if (corpo?.action === "revisao_config_frete") {
        return Promise.resolve({ data: { revisaoConfig: "rev" }, error: null });
      }
      return Promise.resolve({
        data: {
          options: opcoesDaEdge,
          cotacaoIncompleta: false,
          revisaoConfig: "rev",
        },
        error: null,
      });
    });
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
  });

  async function pintar() {
    await act(async () => {
      raiz.render(
        <ContextoDoFreteDaLoja.Provider
          value={contextoDaLojaParaFrete(LOJA_SF)}
        >
          <ShippingCalculator
            cart={CARRINHO}
            selectedOption={null}
            onSelectOption={() => {}}
            cepDestino={CEP}
          />
        </ContextoDoFreteDaLoja.Provider>,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  const botao = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(ROTULO),
    );

  it("cotação vazia + loja com WhatsApp: o botão aparece e abre o wa.me da loja com o CEP", async () => {
    lojaAtual.whatsappNumber = "(34) 99999-1234";
    await pintar();

    expect(hospedeiro.textContent).toContain(TEXTO_SEM_OPCAO);
    const b = botao();
    expect(b).toBeDefined();

    act(() => {
      b?.click();
    });
    expect(abrir).toHaveBeenCalledTimes(1);
    const [url, alvo, recursos] = abrir.mock.calls[0] as string[];
    expect(url.startsWith("https://wa.me/5534999991234?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toBe(
      "Olá! Quero combinar a entrega para o CEP 01001-000.",
    );
    expect(alvo).toBe("_blank");
    expect(recursos).toBe("noopener,noreferrer");
  });

  it("cotação vazia + loja SEM WhatsApp: o texto atual fica e não há botão", async () => {
    await pintar();

    expect(hospedeiro.textContent).toContain(TEXTO_SEM_OPCAO);
    expect(hospedeiro.textContent).toContain("combine a entrega com a loja");
    expect(botao()).toBeUndefined();
  });

  it("número curto demais não conta como WhatsApp (mesma régua do checkout)", async () => {
    lojaAtual.whatsappNumber = "99999";
    await pintar();

    expect(hospedeiro.textContent).toContain(TEXTO_SEM_OPCAO);
    expect(botao()).toBeUndefined();
  });

  it("com opção de entrega disponível o botão não aparece, mesmo com WhatsApp", async () => {
    lojaAtual.whatsappNumber = "34999991234";
    opcoesDaEdge = [OPCAO];
    await pintar();

    expect(hospedeiro.textContent).not.toContain(TEXTO_SEM_OPCAO);
    expect(botao()).toBeUndefined();
  });
});
