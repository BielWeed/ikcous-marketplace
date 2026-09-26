// @vitest-environment jsdom
//
// Ponto do defeito, medido no teste de credenciais (ramo `catch` de
// `handleTestCredentials`): quando testar as credenciais de frete falha, a
// LOJISTA lia o `err.message` cru — que aqui é sempre a frase fixa em inglês
// que o SDK `@supabase/functions-js` usa para uma resposta HTTP fora de 2xx
// ("Edge Function returned a non-2xx status code") — direto no banner de
// resultado do teste.
//
// MUDOU DE TELA (frente glm-visual-admin-0209, pedido do Gabriel 02/09): o
// teste de conexão saiu da tela de Frete e agora vive na seção
// "Transportadoras e cotação de frete" da tela de Ajustes
// (`TransportadorasSection`). A tradução do erro vem junto, e ESTE arquivo
// continua sendo a prova — agora contra o componente novo.
//
// RELEASE 1.5.7 v2: a leitura inicial passou a ser `ler_configuracao_frete`
// pela edge — o mock abaixo responde essa ação para a seção carregar
// normalmente; o alvo do arquivo (tradução do erro NOMEADO do SDK
// `@supabase/functions-js`, distinto da tradução por MOTIVO de
// transportadoras-teste-de-credenciais.test.tsx, que cobre R1-8) continua o
// mesmo.
//
// Modelo estrutural copiado de admin-shipping-tela-nao-promete-cobranca.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

const RESPOSTA_ME_LIGADO = {
  success: true,
  modo: "legado",
  ligados: ["melhor_envio"],
  provedores: {
    melhor_envio: { tem_chave: false, sandbox: false, servicos: null },
    superfrete: { tem_chave: false, sandbox: false, servicos: null },
    frenet: { tem_chave: false, sandbox: false, servicos: null },
  },
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: {
      invoke: (nome: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          return Promise.resolve({ data: RESPOSTA_ME_LIGADO, error: null });
        }
        return invoke(nome, opcoes);
      },
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TransportadorasSection — erro ao testar credenciais de frete sai traduzido, nunca cru", () => {
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

  // Mira o cartão da FRENET (terceiro, sem sandbox nem e-mail obrigatório —
  // Melhor Envio e SuperFrete ganharam e-mail de contato exigido em cada
  // consulta na R3-7, o que tornaria este teste genérico de tradução de
  // erro refém de mais um campo que não é o foco aqui).
  async function abrirSecaoEDigitarToken() {
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const campoToken = [
      ...hospedeiro.querySelectorAll('input[type="password"]'),
    ][2] as HTMLInputElement;
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
    const botaoTestar = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).filter((b) => b.textContent?.trim() === "Testar")[2] as HTMLButtonElement;
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

    await abrirSecaoEDigitarToken();
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

    await abrirSecaoEDigitarToken();
    await clicarTestar();

    expect(texto()).not.toContain("Failed to send a request");
    expect(texto()).toContain(
      "Sem conexão com o servidor. Verifique sua internet e tente novamente.",
    );
  });
});
