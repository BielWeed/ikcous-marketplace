// @vitest-environment jsdom
//
// CONTRATO-1.5.7.md §9 R3-7 (ordem do dono, 22/09/2026): o Melhor Envio
// também exige e-mail de contato em cada consulta — ganha o MESMO campo,
// a MESMA validação e as MESMAS mensagens que a SuperFrete usa desde a
// 1.5.5 (ver transportadoras-por-provedor-e-ligados.test.tsx). O que é
// DIFERENTE, e o que este arquivo prende:
//
//   1. SALVAR a credencial do ME NÃO exige e-mail — campo vazio manda
//      `save_credentials` SEM `contact_email` (mantém o que já está salvo
//      no servidor), ao contrário da SuperFrete, que bloqueia o salvar sem
//      e-mail válido (regra 1.5.5, intacta, provada no outro arquivo);
//   2. se a lojista DIGITAR algo, o formato precisa ser válido (mesma
//      `emailDeContatoValido`, mesma mensagem de formato inválido) — e
//      bloqueia o salvar se estiver errado;
//   3. TESTAR (`test_credentials`) exige e-mail válido para o ME, igual à
//      SuperFrete — "cada consulta" inclui o teste;
//   4. `save_active_providers` pode recusar LIGAR o ME sem e-mail — a tela
//      mostra a mensagem que o SERVIDOR devolveu, sem inventar a própria;
//   5. o valor atual vem só de `provedores.melhor_envio.contato_email` —
//      nunca herda o que está digitado no cartão da SuperFrete;
//   6. o e-mail digitado nunca aparece em `console.error` nem em mensagem
//      de erro genérica quando a chamada falha.
//
// E-mails e tokens abaixo são FICTÍCIOS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, descartarCache } = vi.hoisted(() => ({
  invoke: vi.fn(),
  descartarCache: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: () => descartarCache(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Melhor Envio já tem chave salva e um e-mail próprio (distinto de
// qualquer coisa que a SuperFrete possa ter) — prova o item 5 (nunca herda
// entre provedores).
const RESPOSTA_BASE = {
  success: true,
  modo: "multi",
  ligados: ["melhor_envio"],
  provedores: {
    melhor_envio: {
      tem_chave: true,
      sandbox: false,
      servicos: null,
      contato_email: "ja-salvo-no-me@loja-ficticia.com.br",
    },
    superfrete: {
      tem_chave: true,
      sandbox: false,
      servicos: null,
      contato_email: "outro-email-da-sf@loja-ficticia.com.br",
    },
    frenet: { tem_chave: false, sandbox: false, servicos: null },
  },
};

describe("TransportadorasSection — Melhor Envio ganha e-mail de contato (R3-7)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      const action = opcoes?.body?.action;
      if (action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_BASE, error: null });
      }
      if (action === "save_credentials") {
        return Promise.resolve({ data: { success: true }, error: null });
      }
      if (action === "save_active_providers") {
        return Promise.resolve({
          data: { success: true, ligados: [] },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
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
    vi.restoreAllMocks();
  });

  async function abrir() {
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const botoes = (re: RegExp) =>
    [...hospedeiro.querySelectorAll("button")].filter((b) =>
      re.test(b.textContent?.trim() ?? ""),
    ) as HTMLButtonElement[];
  const camposEmail = () =>
    [
      ...hospedeiro.querySelectorAll('input[type="email"]'),
    ] as HTMLInputElement[];
  // Melhor Envio é o PRIMEIRO cartão (ORDEM_DOS_PROVEDORES).
  const emailME = () => camposEmail()[0];
  const botaoSalvarME = () => botoes(/^Salvar$/)[0];
  const botaoTestarME = () => botoes(/^Testar$/)[0];

  async function clicar(b: HTMLElement | undefined) {
    expect(b).toBeDefined();
    await act(async () => {
      b?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function digitar(campo: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("o cartão do Melhor Envio ganhou o campo de e-mail, com a explicação de 'cada consulta'", async () => {
    await abrir();
    expect(camposEmail()).toHaveLength(2); // Melhor Envio + SuperFrete.
    expect(hospedeiro.textContent).toMatch(
      /O Melhor Envio exige um e-mail de contato em cada consulta/,
    );
  });

  it("o valor atual vem só de provedores.melhor_envio.contato_email — nunca herda o e-mail da SuperFrete", async () => {
    await abrir();
    expect(emailME().value).toBe("ja-salvo-no-me@loja-ficticia.com.br");
    expect(emailME().value).not.toContain("outro-email-da-sf");
  });

  it("salvar com o campo VAZIO mantém o salvo: save_credentials NÃO leva contact_email", async () => {
    await abrir();
    // Esvazia o e-mail pré-preenchido.
    await digitar(emailME(), "");
    // Precisa digitar uma chave nova OU já ter uma salva — a fixture já tem.
    invoke.mockClear();
    await clicar(botaoSalvarME());

    expect(invoke).toHaveBeenCalledWith(
      "calculate-shipping",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "save_credentials",
          provider: "melhor_envio",
        }),
      }),
    );
    const corpo = invoke.mock.calls.find(
      (c: any[]) => c[1]?.body?.action === "save_credentials",
    )?.[1]?.body;
    expect(corpo).not.toHaveProperty("contact_email");
  });

  it("e-mail com formato inválido bloqueia o Salvar do Melhor Envio, com a MESMA mensagem da SuperFrete", async () => {
    await abrir();
    const { toast } = await import("sonner");
    await digitar(emailME(), "nao-e-um-email");
    invoke.mockClear();
    await clicar(botaoSalvarME());

    expect(invoke).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Confira o e-mail de contato técnico: use um endereço completo, sem espaços nem acentos (exemplo: voce@sualoja.com.br).",
    );
  });

  it("e-mail válido novo: Salvar envia contact_email normalmente", async () => {
    await abrir();
    await digitar(emailME(), "novo-tecnico@loja-ficticia.com.br");
    invoke.mockClear();
    await clicar(botaoSalvarME());

    expect(invoke).toHaveBeenCalledWith(
      "calculate-shipping",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "save_credentials",
          provider: "melhor_envio",
          contact_email: "novo-tecnico@loja-ficticia.com.br",
        }),
      }),
    );
  });

  it("Testar exige e-mail válido — igual à SuperFrete, 'cada consulta' inclui o teste", async () => {
    await abrir();
    const { toast } = await import("sonner");
    await digitar(emailME(), "");
    invoke.mockClear();
    await clicar(botaoTestarME());

    const chamouTeste = invoke.mock.calls.some(
      (c: any[]) => c[1]?.body?.action === "test_credentials",
    );
    expect(chamouTeste).toBe(false);
    // ANOTADO (revisão Opus): a frase não promete "salvar" para o Melhor
    // Envio — salvar aceita o campo vazio (R3-7). Só TESTAR exige o
    // e-mail; a mensagem diz só isso, ao contrário da SuperFrete.
    expect(toast.error).toHaveBeenCalledWith(
      "Preencha o e-mail de contato técnico para testar o Melhor Envio.",
    );
  });

  it("save_active_providers recusa ligar o ME sem e-mail: mostra a mensagem do SERVIDOR, não uma própria", async () => {
    // ME tem chave mas NÃO está ligado ainda, e não tem e-mail salvo — o
    // teste marca a caixa (ligadosEscolhidos muda) e tenta ligar.
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      const action = opcoes?.body?.action;
      if (action === "ler_configuracao_frete") {
        return Promise.resolve({
          data: {
            ...RESPOSTA_BASE,
            ligados: [],
            provedores: {
              ...RESPOSTA_BASE.provedores,
              melhor_envio: {
                ...RESPOSTA_BASE.provedores.melhor_envio,
                contato_email: "",
              },
            },
          },
          error: null,
        });
      }
      if (action === "save_active_providers") {
        return Promise.resolve({
          data: {
            success: false,
            error:
              "O Melhor Envio precisa de um e-mail de contato salvo antes de ser ligado.",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    const { toast } = await import("sonner");

    // Marca a caixa "Melhor Envio" no bloco de ligados (tem chave, sem
    // sandbox — pode marcar, mesmo sem e-mail: a recusa é do SERVIDOR).
    const caixaMelhorEnvio = [
      ...hospedeiro.querySelectorAll('input[type="checkbox"]'),
    ][0] as HTMLInputElement;
    await act(async () => {
      caixaMelhorEnvio.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const botaoSalvarLigados = botoes(/Salvar provedores/)[0];
    await clicar(botaoSalvarLigados);

    expect(toast.error).toHaveBeenCalledWith(
      "O Melhor Envio precisa de um e-mail de contato salvo antes de ser ligado.",
    );
  });

  it("o e-mail digitado nunca aparece em console.error quando a chamada falha", async () => {
    const espiaoConsole = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      const action = opcoes?.body?.action;
      if (action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_BASE, error: null });
      }
      if (action === "save_credentials") {
        return Promise.reject(new Error("Failed to fetch"));
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    const emailSecreto = "email-que-nao-pode-vazar@loja-ficticia.com.br";
    await digitar(emailME(), emailSecreto);
    await clicar(botaoSalvarME());

    const textoLogado = espiaoConsole.mock.calls
      .flat()
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join(" | ");
    expect(textoLogado).not.toContain(emailSecreto);
    espiaoConsole.mockRestore();
  });
});
