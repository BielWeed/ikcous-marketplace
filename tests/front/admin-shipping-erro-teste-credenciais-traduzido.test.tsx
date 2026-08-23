// @vitest-environment jsdom
//
// Ponto do defeito, medido em AdminShippingView.tsx (handleTestCredentials,
// ramo `catch`): quando testar as credenciais de frete falha, a LOJISTA lia
// o `err.message` cru — que aqui é sempre a frase fixa em inglês que o SDK
// `@supabase/functions-js` usa para uma resposta HTTP fora de 2xx ("Edge
// Function returned a non-2xx status code") — direto no banner de
// resultado do teste.
//
// Modelo estrutural copiado de admin-shipping-tela-nao-promete-cobranca.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfig, invoke } = vi.hoisted(() => ({
  mockConfig: {
    freeShippingMin: 100,
    shippingFee: 10,
    shippingCoverage: "national" as "local" | "national",
    shippingProvider: "melhor_envio" as "flat_fee" | "melhor_envio" | "frenet",
    originCep: "38500-000",
    enabledShippingMethods: ["sedex", "pac"] as string[],
    localDeliveryFee: 10,
    localCepRange: "",
  },
  invoke: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminShippingView — erro ao testar credenciais de frete sai traduzido, nunca cru", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTelaEDigitarToken() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={true} onSetDirty={vi.fn()} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const campoToken = hospedeiro.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    expect(campoToken).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campoToken, "token-de-teste");
      campoToken.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function clicarTestar() {
    const botaoTestar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Testar",
    ) as HTMLButtonElement;
    expect(botaoTestar).toBeTruthy();
    return act(async () => {
      botaoTestar.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  it("FunctionsHttpError (resposta fora de 2xx): o banner mostra a frase traduzida, NUNCA o rótulo do SDK", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "Edge Function returned a non-2xx status code",
        context: { status: 500 },
      },
    });

    await abrirTelaEDigitarToken();
    await clicarTestar();

    expect(texto()).not.toContain("non-2xx");
    expect(texto()).not.toContain("FunctionsHttpError");
    expect(texto()).toContain(
      "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
    );
  });

  it("FunctionsFetchError (o fetch em si falhou): o banner avisa sobre a CONEXÃO, causa verificada", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsFetchError",
        message: "Failed to send a request to the Edge Function",
      },
    });

    await abrirTelaEDigitarToken();
    await clicarTestar();

    expect(texto()).not.toContain("Failed to send a request");
    expect(texto()).toContain(
      "Sem conexão com o servidor. Verifique sua internet e tente novamente.",
    );
  });
});
