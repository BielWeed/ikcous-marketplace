// @vitest-environment jsdom
//
// Peça 20, retomada (14/09/2026, à noite — pedido do dono vendo a tela): a
// seção "Mercado Pago" mostrou "Sem conexão com o servidor. Verifique sua
// internet" com a internet do dono PERFEITA. Medido na hora: a edge nova
// `credenciais-mercado-pago` ainda não estava publicada no projeto — o
// gateway responde 404 SEM CORS, o navegador engole a resposta e o SDK
// entrega ao componente um FunctionsFetchError, que o tradutor da casa
// traduzia como rede. Duas causas diferentes pedem dois conselhos
// diferentes. O que ESTE arquivo prova:
//   H1  HTTP 404 do gateway (função não publicada) → o banner diz que o
//       SERVIÇO não está ativado — nunca "verifique sua internet";
//   H2  fetch error com navegador ONLINE → mesma frase de serviço inativo
//       (o caminho real que mentiu para o dono);
//   H3  fetch error com navegador OFFLINE de verdade → aí sim "verifique
//       sua internet" é a verdade;
//   H4  guarda do tradutor: SEM o opt-in, FunctionsFetchError continua
//       devolvendo a frase de rede (o frete não muda nada).
//
// Mesmo padrão da casa: createRoot + act puros, dependências de fora
// mockadas, dublê de edge REJEITANDO com erro no formato do SDK.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SERVICO_INATIVO =
  "O serviço de chaves do Mercado Pago ainda não está ativado nesta instalação. Fale com o suporte para ativá-lo no servidor.";
const FRASE_DE_REDE =
  "Sem conexão com o servidor. Verifique sua internet e tente novamente.";

const { invokeFalso, cenario } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  cenario: { erro: null as unknown },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

// Online: o componente checa a rede ANTES de invocar (guarda própria) — o
// erro em prova aqui vem DEPOIS, do invoke.
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";

/** Erro no formato que o SDK entrega para resposta HTTP fora de 2xx. */
function erroHttp(status: number, corpo: string) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(corpo, {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

describe("MercadoPagoSection — a mensagem de erro diz a causa real", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onLineOriginal: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    cenario.erro = null;
    invokeFalso.mockResolvedValue({ data: null, error: null });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    onLineOriginal = Object.getOwnPropertyDescriptor(navigator, "onLine");
  });

  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
    hospedeiro.remove();
    if (onLineOriginal) {
      Object.defineProperty(navigator, "onLine", onLineOriginal);
    } else {
      Reflect.deleteProperty(navigator, "onLine");
    }
  });

  async function montar(): Promise<void> {
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<MercadoPagoSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  it("H1 — 404 do gateway diz que o serviço não está ativado, não que é internet", async () => {
    // Corpo do gateway SEM `{ erro }` — o texto técnico dele não é nosso.
    invokeFalso.mockResolvedValue({
      data: null,
      error: erroHttp(404, '{"msg":"Function not found"}'),
    });

    await montar();

    const texto = document.body.textContent ?? "";
    expect(texto).toContain(SERVICO_INATIVO);
    expect(texto).not.toContain("Verifique sua internet");
    // o resgate continua na mão de quem lê
    expect(texto).toContain("Tentar de novo");
  });

  it("H2 — fetch error com navegador online também é serviço inativo (o caso que mentiu para o dono)", async () => {
    Object.defineProperty(navigator, "onLine", {
      get: () => true,
      configurable: true,
    });
    invokeFalso.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsFetchError",
        message: "Failed to send a request to the Edge Function",
      },
    });

    await montar();

    const texto = document.body.textContent ?? "";
    expect(texto).toContain(SERVICO_INATIVO);
    expect(texto).not.toContain("Verifique sua internet");
  });

  it("H3 — fetch error com navegador OFFLINE de verdade: aí é internet mesmo", async () => {
    Object.defineProperty(navigator, "onLine", {
      get: () => false,
      configurable: true,
    });
    invokeFalso.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsFetchError",
        message: "Failed to send a request to the Edge Function",
      },
    });

    await montar();

    const texto = document.body.textContent ?? "";
    expect(texto).toContain(FRASE_DE_REDE);
    expect(texto).not.toContain(SERVICO_INATIVO);
  });

  it("H4 — sem o opt-in, o tradutor mantém a frase de rede (frete não muda nada)", () => {
    const erro = {
      name: "FunctionsFetchError",
      message: "Failed to send a request to the Edge Function",
    };
    expect(
      mensagemAmigavelErroEdgeFunction(erro, {
        mensagemGenerica: "genérico",
      }),
    ).toBe(FRASE_DE_REDE);
    // e HTTP fora de 2xx sem opt-in segue no genérico de quem chamou
    expect(
      mensagemAmigavelErroEdgeFunction(erroHttp(404, "{}"), {
        mensagemGenerica: "genérico",
      }),
    ).toBe("genérico");
  });
});
