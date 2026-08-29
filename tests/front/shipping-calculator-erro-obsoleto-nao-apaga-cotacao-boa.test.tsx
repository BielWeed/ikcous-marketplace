// @vitest-environment jsdom
//
// Uma cotação obsoleta pode FALHAR depois que uma cotação mais nova já teve
// sucesso — a transportadora pode demorar mais para dar erro do que para
// responder bem. Sem uma guarda no `catch`, esse erro tardio limparia
// `options` e chamaria `onSelectOption(null)` por cima de uma cotação boa que
// já estava na tela: a cliente perderia a cotação certa e veria um erro sem
// motivo.
//
// A guarda (`if (meuId !== reqRef.current) return;` no início do `catch`) já
// existe no componente — esta suíte é o teste que faltava para prendê-la.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
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

const carrinho: CartItem[] = [{ product: produto(), quantity: 1 }];

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — falha obsoleta não apaga uma cotação boa mais nova", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let selecionadas: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("a opção boa da cotação NOVA continua na tela depois que a cotação VELHA falha", async () => {
    // 1ª chamada (cotação inicial ao montar): resolve na hora.
    invoke.mockResolvedValueOnce({
      data: {
        options: [
          { id: "melhorenvio-pac", name: "PAC", price: 10, deliveryDays: 7 },
        ],
      },
      error: null,
    });

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
      setter?.call(campo, "69000000");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const formulario = hospedeiro.querySelector("form") as HTMLFormElement;
    async function enviar() {
      await act(async () => {
        formulario.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    await enviar();
    expect(invoke).toHaveBeenCalledTimes(1);

    // O envio âncora acabou de gravar o cache local do CEP — sem invalidá-lo,
    // os dois envios seguintes (mesmo CEP) seriam cache HIT e nem chegariam a
    // chamar a transportadora.
    localStorage.removeItem("ikcous_shipping_cache_69000000");

    // A partir daqui: a 1ª chamada ("A", obsoleta) FALHA depois de 3000ms; a
    // 2ª chamada ("B", a mais nova) TEM SUCESSO em 500ms — B responde bem
    // antes de A.
    let chamada = 0;
    invoke.mockImplementation(() => {
      chamada += 1;
      if (chamada === 1) {
        return new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("Falha ao cotar frete (obsoleta).")),
            3000,
          ),
        );
      }
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              data: {
                options: [
                  {
                    id: "melhorenvio-sedex",
                    name: "SEDEX",
                    price: 50,
                    deliveryDays: 2,
                  },
                ],
              },
              error: null,
            }),
          500,
        ),
      );
    });

    await enviar(); // A: meuId=2, falha em +3000ms.
    await enviar(); // B: meuId=3, sucesso em +500ms — é a MAIS NOVA.
    expect(invoke).toHaveBeenCalledTimes(3);

    // t=500: B (a mais nova) tem sucesso.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(hospedeiro.textContent).toContain("50,00");
    expect(hospedeiro.textContent).not.toContain("Erro ao calcular frete");

    // t=3000: A (obsoleta) finalmente falha.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    // A cotação boa de B continua na tela — nada foi apagado pela falha
    // tardia de A, e nenhuma mensagem de erro apareceu por cima dela.
    expect(hospedeiro.textContent).toContain("50,00");
    expect(hospedeiro.textContent).not.toContain("Erro ao calcular frete");
    const ultimaSelecionada = selecionadas[selecionadas.length - 1] as
      | { price: number }
      | null
      | undefined;
    expect(ultimaSelecionada?.price).toBe(50);
  });
});
