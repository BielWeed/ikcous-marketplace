// @vitest-environment jsdom
//
// Achado 2 da revisão do commit ec4cbdd: ShippingCalculator.tsx tinha a
// mesma frase — "Sem conexão com a internet." — escrita em DOIS lugares sem
// nada os amarrando: o `throw new Error(...)` de quando `isOffline` (por
// volta da linha 230, na função `calculateShipping`) e a lista
// `mensagensSeguras` do `catch`, 53 linhas depois. Cada um é um literal de
// string independente; nada no compilador nem em tempo de execução garante
// que os dois continuem iguais.
//
// O risco: quem editar UM dos dois (revisão de texto, um acento) sem lembrar
// do outro faz `mensagemAmigavelErroEdgeFunction` parar de reconhecer o
// literal como "seguro" — e o comprador OFFLINE passa a ler o genérico
// ("Não foi possível calcular o frete agora. Tente novamente em instantes.")
// em vez do aviso de conexão. Conselho errado para quem está sem internet:
// "tente de novo" não resolve nada se o problema é falta de rede.
//
// O conserto (ShippingCalculator.tsx) extraiu as DUAS frases para
// constantes de módulo (`MENSAGEM_SEM_CONEXAO_FRETE`,
// `MENSAGEM_FALHA_AO_COTAR`) usadas nos dois lugares — divergir as duas
// deixa de ser possível por uma edição de texto solta, porque editar a
// constante muda os dois usos ao mesmo tempo.
//
// Modelo estrutural copiado de
// shipping-calculator-erro-traduzido-nao-mostra-texto-cru.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
// `isOffline` = true — o ramo sob prova (`calculateShipping` nunca chega a
// chamar `supabase.functions.invoke`; lança antes, por conta própria).
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const carrinho: CartItem[] = [
  {
    product: {
      id: "prod-1",
      name: "Blusa Teste",
      description: "",
      price: 100,
      images: [],
      category: "Roupas",
      stock: 5,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: new Date(0).toISOString(),
    },
    quantity: 1,
  },
];

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — offline não pode virar o genérico (as duas frases não podem divergir)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let selecionadas: unknown[];

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
    invoke.mockReset();
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
  });

  async function montarECotar(cepDigitado: string) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );

    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          subtotal={100}
          freeShippingMin={0}
          selectedOption={null}
          onSelectOption={(opt) => selecionadas.push(opt)}
        />,
      );
    });

    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, cepDigitado);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const formulario = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("comprador offline vê o aviso de CONEXÃO, nunca o genérico de 'tente novamente'", async () => {
    await montarECotar("69000000");

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Sem conexão com a internet.");
    // A âncora que o achado 2 protege: se as duas frases divergirem, é
    // ISSO que aparece no lugar do aviso de conexão.
    expect(texto).not.toContain(
      "Não foi possível calcular o frete agora. Tente novamente em instantes.",
    );
    // A Edge Function nunca chega a ser chamada — a checagem de offline
    // lança ANTES, dentro do próprio componente.
    expect(invoke).not.toHaveBeenCalled();
  });
});
