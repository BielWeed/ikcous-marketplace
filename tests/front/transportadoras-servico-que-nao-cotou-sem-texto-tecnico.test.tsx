// @vitest-environment jsdom
//
// Teste de transportadora no painel: quando um serviço não consegue cotar, a
// lojista lia o texto ORIGINAL do provedor ("não cotou (Service unavailable)")
// — inglês e técnico. Agora o detalhe só aparece quando é uma frase curta em
// português (ex.: "dimensões", "não atende o trecho"); o resto vira uma frase
// fixa e o texto cru fica só no console.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRASE_SERVICO_NAO_COTOU,
  textoDoServicoQueNaoCotou,
} from "@/components/admin/settings/transportadoras-conteudo";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("textoDoServicoQueNaoCotou — só frase em português chega à lojista", () => {
  it("detalhe curto em português passa como veio", () => {
    expect(textoDoServicoQueNaoCotou("dimensões")).toBe(
      "não cotou (dimensões)",
    );
    expect(textoDoServicoQueNaoCotou("não atende o trecho")).toBe(
      "não cotou (não atende o trecho)",
    );
  });

  it("sem detalhe, mantém 'erro do serviço'", () => {
    expect(textoDoServicoQueNaoCotou(undefined)).toBe(
      "não cotou (erro do serviço)",
    );
  });

  it.each([
    "Service unavailable",
    "Something went wrong",
    "Melhor Envio API retornou 500: Internal Server Error",
    '{"error":"timeout"}',
    "Request failed with status 503",
  ])("texto cru/inglês %j vira a frase fixa", (cru) => {
    const texto = textoDoServicoQueNaoCotou(cru);
    expect(texto).toBe(FRASE_SERVICO_NAO_COTOU);
    expect(texto).not.toContain(cru);
  });

  it("a frase fixa é português simples, sem jargão", () => {
    expect(FRASE_SERVICO_NAO_COTOU).toBe(
      "não conseguiu cotar agora — tente de novo em instantes",
    );
  });
});

describe("TransportadorasSection — o Testar não mostra o erro cru do provedor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function testarFrenet(respostaTeste: unknown) {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      const acao = opcoes?.body?.action;
      if (acao === "ler_configuracao_frete") {
        return Promise.resolve({
          data: {
            success: true,
            modo: "multi",
            ligados: ["frenet"],
            provedores: {
              melhor_envio: {
                tem_chave: false,
                sandbox: false,
                servicos: null,
              },
              superfrete: { tem_chave: false, sandbox: false, servicos: null },
              frenet: { tem_chave: true, sandbox: false, servicos: null },
            },
          },
          error: null,
        });
      }
      if (acao === "test_credentials") {
        return Promise.resolve({ data: respostaTeste, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    const { TransportadorasSection } = await import(
      "./apoio/transportadoras-isoladas"
    );
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        if (i === 0) raiz.render(<TransportadorasSection />);
        await esperarMicrotarefas();
      });
    }
    const botao = [...hospedeiro.querySelectorAll("button")].filter((b) =>
      /^Testar$/.test(b.textContent?.trim() ?? ""),
    )[2] as HTMLButtonElement;
    expect(botao).toBeTruthy();
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("serviço com erro em inglês: a tela mostra a frase fixa, nunca 'Service unavailable'", async () => {
    await testarFrenet({
      success: false,
      motivo: "sem_cotacao_valida",
      servicosTestados: [
        {
          codigo: "1",
          ok: false,
          motivo: "erro_do_servico",
          detalhe: "Service unavailable",
        },
      ],
    });

    expect(hospedeiro.textContent).not.toContain("Service unavailable");
    expect(hospedeiro.textContent).toContain(
      "Serviço 1: não conseguiu cotar agora — tente de novo em instantes",
    );
  });

  it("o texto cru do provedor continua no console, para quem investiga", async () => {
    await testarFrenet({
      success: false,
      motivo: "sem_cotacao_valida",
      servicosTestados: [
        {
          codigo: "1",
          ok: false,
          motivo: "erro_do_servico",
          detalhe: "Service unavailable",
        },
      ],
    });

    const registrado = (console.warn as unknown as ReturnType<typeof vi.fn>)
      .mock.calls;
    expect(JSON.stringify(registrado)).toContain("Service unavailable");
  });

  it("serviço com motivo em português continua explicando o motivo", async () => {
    await testarFrenet({
      success: false,
      motivo: "sem_cotacao_valida",
      servicosTestados: [
        {
          codigo: "1",
          ok: false,
          motivo: "erro_do_servico",
          detalhe: "não atende o trecho",
        },
      ],
    });

    expect(hospedeiro.textContent).toContain(
      "Serviço 1: não cotou (não atende o trecho)",
    );
  });
});
