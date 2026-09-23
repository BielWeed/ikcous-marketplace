// @vitest-environment jsdom
//
// Captura do dono (23/09/2026, celular): "Loggi — Express · via Melhor
// Envio" R$ 10,49 com os selos MAIS BARATA/MAIS RÁPIDA, mas a opção marcada
// era "Entrega econômica — Correios PAC · via SuperFrete" R$ 25,31 e o total
// somava os R$ 25,31. Causa: `opcaoFrescaOuMaisBarata` preservava POR ID
// qualquer seleção que ainda existisse na lista nova — sem distinguir a
// escolha que o APP fez sozinho (PAC, quando só a SuperFrete tinha
// respondido) da escolha que a CLIENTE fez com um toque. Quando a cotação
// seguinte trouxe a Loggi mais barata, o PAC automático "sobreviveu".
//
// Regra do dono: o carrinho abre com a MAIS BARATA; escolha da cliente é
// preservada enquanto valer; se ela sumir, volta a mais barata.
//
// O pai deste teste espelha o CartContext de verdade: guarda a opção E a
// origem (`cliente`/`automatica`) e remonta a calculadora como a navegação
// carrinho → checkout → volta faz (a calculadora nasce de novo, a escolha
// vive no contexto).
import { act, useEffect, useState } from "react";
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
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const REVISAO = "rev-teste";
const CEP = "69000000";

function produto(): Product {
  return {
    id: "prod-1",
    name: "Blusa",
    description: "",
    price: 59.9,
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
const CARRINHO: CartItem[] = [{ product: produto(), quantity: 1 }];

const PAC_SF: ShippingOption = {
  id: "superfrete-1",
  name: "Entrega econômica",
  price: 25.31,
  deliveryDays: 8,
  provider: "superfrete",
  transportadora: "Correios",
  servico: "PAC",
  provedorRotulo: "SuperFrete",
};
const LOGGI_ME: ShippingOption = {
  id: "melhor-envio-31",
  name: "Loggi — Express",
  price: 10.49,
  deliveryDays: 3,
  provider: "melhor_envio",
  transportadora: "Loggi",
  servico: "Express",
  provedorRotulo: "Melhor Envio",
};
const SEDEX_SF: ShippingOption = {
  id: "superfrete-2",
  name: "Entrega expressa",
  price: 31.8,
  deliveryDays: 4,
  provider: "superfrete",
  transportadora: "Correios",
  servico: "SEDEX",
  provedorRotulo: "SuperFrete",
};

describe("ShippingCalculator — escolha AUTOMÁTICA cede à mais barata; escolha da CLIENTE fica", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let resposta: { data: unknown; error: unknown };

  // Espelho do CartContext.
  const pai = {
    opcao: null as ShippingOption | null,
    origem: "automatica" as OrigemDaEscolhaDoFrete,
    remontar: () => {},
  };

  beforeEach(() => {
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
      },
    });
    invoke.mockReset();
    invoke.mockImplementation((_n: string, opts: any) => {
      if (opts?.body?.action === "revisao_config_frete") {
        return Promise.resolve({
          data: { revisaoConfig: REVISAO },
          error: null,
        });
      }
      return Promise.resolve(resposta);
    });
    pai.opcao = null;
    pai.origem = "automatica";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function responder(opcoes: ShippingOption[]) {
    resposta = { data: { options: opcoes, revisaoConfig: REVISAO }, error: null };
  }

  async function assentar() {
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
  }

  async function montar() {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    function Pai() {
      const [escolha, setEscolha] = useState<{
        opcao: ShippingOption | null;
        daCliente: boolean;
      }>({ opcao: null, daCliente: false });
      const [cepDaSelecao, setCepDaSelecao] = useState<string | null>(null);
      // Remontar = a calculadora nasce de novo (ida ao checkout e volta).
      const [chave, setChave] = useState(0);
      useEffect(() => {
        pai.opcao = escolha.opcao;
        pai.origem = escolha.daCliente ? "cliente" : "automatica";
        pai.remontar = () => setChave((c) => c + 1);
      }, [escolha]);
      return (
        <ShippingCalculator
          key={chave}
          cart={CARRINHO}
          selectedOption={escolha.opcao}
          selecaoEscolhidaPelaCliente={escolha.daCliente}
          onSelectOption={(opcao, origem = "automatica") =>
            setEscolha({
              opcao,
              daCliente: opcao !== null && origem === "cliente",
            })
          }
          onCepValidated={(cep) => setCepDaSelecao(cep)}
          cepDestino={CEP}
          cepDaSelecao={cepDaSelecao}
        />
      );
    }
    await act(async () => {
      raiz.render(<Pai />);
    });
    await assentar();
  }

  async function remontar() {
    await act(async () => {
      pai.remontar();
    });
    await assentar();
  }

  async function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );
    expect(botao, `botão "${texto}"`).toBeDefined();
    await act(async () => {
      botao?.click();
    });
  }

  it("🔴 captura do dono: PAC auto-selecionado quando só a SuperFrete respondeu; a cotação seguinte traz a Loggi mais barata — a seleção passa para a Loggi", async () => {
    responder([PAC_SF, SEDEX_SF]);
    await montar();
    expect(pai.opcao?.id).toBe(PAC_SF.id);
    expect(pai.origem).toBe("automatica");

    // Melhor Envio passou a responder; a calculadora remonta (volta ao
    // carrinho) e o cache é recusado pela revisão nova.
    armazem.clear();
    responder([PAC_SF, SEDEX_SF, LOGGI_ME]);
    await remontar();

    expect(pai.opcao?.id).toBe(LOGGI_ME.id);
    expect(pai.opcao?.price).toBe(10.49);
    expect(pai.origem).toBe("automatica");
  });

  it("🔴 mesmo caminho pelo CACHE do navegador: envelope válido com a Loggi — a escolha automática antiga (PAC) cede", async () => {
    responder([PAC_SF, SEDEX_SF]);
    await montar();
    expect(pai.opcao?.id).toBe(PAC_SF.id);

    // O envelope do cache agora traz a lista com a Loggi (mesma revisão,
    // mesmo carrinho): a remontagem serve do cache.
    const chave = [...armazem.keys()].find((k) =>
      k.startsWith("ikcous_shipping_cache_v2_"),
    );
    expect(chave).toBeDefined();
    const envelope = JSON.parse(armazem.get(chave as string) as string);
    envelope.opcoes = [PAC_SF, SEDEX_SF, LOGGI_ME];
    armazem.set(chave as string, JSON.stringify(envelope));
    const chamadasDeCotacao = () =>
      invoke.mock.calls.filter((c) => !c[1]?.body?.action).length;
    const antes = chamadasDeCotacao();

    await remontar();

    expect(chamadasDeCotacao()).toBe(antes); // veio do cache
    expect(pai.opcao?.id).toBe(LOGGI_ME.id);
  });

  it("escolha da CLIENTE válida é preservada na recotação e na remontagem, com o preço fresco", async () => {
    responder([PAC_SF, SEDEX_SF, LOGGI_ME]);
    await montar();
    expect(pai.opcao?.id).toBe(LOGGI_ME.id);

    await clicar("+ Ver outras opções");
    await clicar("Entrega econômica");
    expect(pai.opcao?.id).toBe(PAC_SF.id);
    expect(pai.origem).toBe("cliente");

    armazem.clear();
    responder([{ ...PAC_SF, price: 24.9 }, SEDEX_SF, LOGGI_ME]);
    await remontar();

    expect(pai.opcao?.id).toBe(PAC_SF.id);
    expect(pai.opcao?.price).toBe(24.9);
    expect(pai.origem).toBe("cliente");
  });

  it("escolha da CLIENTE que SUMIU da cotação nova: volta a mais barata, agora como escolha automática", async () => {
    responder([PAC_SF, SEDEX_SF, LOGGI_ME]);
    await montar();
    await clicar("+ Ver outras opções");
    await clicar("Entrega expressa");
    expect(pai.opcao?.id).toBe(SEDEX_SF.id);
    expect(pai.origem).toBe("cliente");

    armazem.clear();
    responder([PAC_SF, LOGGI_ME]);
    await remontar();

    expect(pai.opcao?.id).toBe(LOGGI_ME.id);
    expect(pai.origem).toBe("automatica");

    // E uma cotação seguinte com a SEDEX de volta não ressuscita a escolha
    // antiga: a seleção é automática e fica na mais barata.
    armazem.clear();
    responder([PAC_SF, SEDEX_SF, LOGGI_ME]);
    await remontar();
    expect(pai.opcao?.id).toBe(LOGGI_ME.id);
  });

  it("controle: o cartão marcado (aria-pressed) é o mesmo cujo preço entra na escolha", async () => {
    responder([PAC_SF, SEDEX_SF]);
    await montar();
    armazem.clear();
    responder([PAC_SF, SEDEX_SF, LOGGI_ME]);
    await remontar();

    const marcados = [
      ...hospedeiro.querySelectorAll('button[aria-pressed="true"]'),
    ];
    expect(marcados).toHaveLength(1);
    expect(marcados[0].textContent).toContain("10,49");
    expect(pai.opcao?.price).toBe(10.49);
  });
});
