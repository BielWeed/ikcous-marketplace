// @vitest-environment jsdom
//
// "Tentar de novo" depois de uma leitura que falha NÃO pode apagar a chave de
// transportadora que a lojista já colou e ainda não salvou (rodada 27).
//
// O defeito: a tela de erro chamava `carregar()` sem argumento, que parte do
// padrão "tudo" — zera o rascunho dos TRÊS provedores. Quem colou a chave,
// trocou de aba, voltou, viu "Não deu para confirmar as transportadoras" e
// tocou em "Tentar de novo" perdia a chave colada, sem aviso.
//
// A regra: o "Tentar de novo" repete o MODO de reset que a leitura que falhou
// pedia —
//   "nenhum"  (volta à aba)            → nenhum rascunho é tocado;
//   provedor  (releitura após salvar)  → só o rascunho dele volta limpo;
//   "tudo"    (carga inicial)          → parte do zero, e "nenhum" posterior
//                                        não rebaixa esse pedido.
//
// Chaves e e-mails abaixo são FICTÍCIOS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      throw new Error("a seção não pode ler o banco direto");
    },
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));
vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: () => {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise((r) => setTimeout(r, 0));

const CONFIG_DO_SERVIDOR = {
  success: true,
  modo: "legado",
  ligados: ["melhor_envio"],
  provedores: {
    melhor_envio: {
      tem_chave: true,
      sandbox: false,
      servicos: null,
      contato_email: "contato@exemplo.com",
    },
    superfrete: { tem_chave: false, sandbox: false, servicos: null },
    frenet: { tem_chave: false, sandbox: false, servicos: null },
  },
};

/** Controle da edge falsa: a leitura falha enquanto `leituraFalha` for true. */
const edge = { leituraFalha: false, leituras: 0 };

describe("TransportadorasSection — Tentar de novo preserva o que foi digitado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    edge.leituraFalha = false;
    edge.leituras = 0;
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      const acao = opcoes?.body?.action;
      if (acao === "ler_configuracao_frete") {
        edge.leituras++;
        if (edge.leituraFalha) {
          return Promise.resolve({
            data: null,
            error: { message: "network error" },
          });
        }
        return Promise.resolve({ data: CONFIG_DO_SERVIDOR, error: null });
      }
      if (acao === "save_credentials") {
        return Promise.resolve({
          data: { success: true, tem_chave: true },
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
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function assentar() {
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await esperar();
      });
    }
  }

  async function renderizar(active: boolean) {
    const { TransportadorasSection } = await import(
      "./apoio/transportadoras-isoladas"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection active={active} />);
    });
    await assentar();
  }

  const botoes = (re: RegExp) =>
    [...hospedeiro.querySelectorAll("button")].filter((b) =>
      re.test(b.textContent?.trim() ?? ""),
    ) as HTMLButtonElement[];
  const camposToken = () =>
    [
      ...hospedeiro.querySelectorAll('input[type="password"]'),
    ] as HTMLInputElement[];
  const camposEmail = () =>
    [
      ...hospedeiro.querySelectorAll('input[type="email"]'),
    ] as HTMLInputElement[];
  const telaDeErro = () =>
    /Não deu para confirmar as transportadoras/i.test(
      hospedeiro.textContent ?? "",
    );

  async function clicar(b: HTMLElement | undefined) {
    expect(b).toBeDefined();
    await act(async () => {
      b?.click();
    });
    await assentar();
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

  it("volta à aba com a leitura falhando: a chave colada sobrevive ao Tentar de novo", async () => {
    await renderizar(true);
    expect(telaDeErro()).toBe(false);
    await digitar(camposToken()[2], "chave-frenet-ficticia");
    expect(camposToken()[2].value).toBe("chave-frenet-ficticia");

    // Sai da aba e volta com a edge fora do ar: a releitura falha.
    await renderizar(false);
    edge.leituraFalha = true;
    await renderizar(true);
    expect(telaDeErro()).toBe(true);

    // A edge volta; a lojista toca em "Tentar de novo".
    edge.leituraFalha = false;
    await clicar(botoes(/^Tentar de novo$/)[0]);

    expect(telaDeErro()).toBe(false);
    // Contra o código anterior esta asserção reprova: o clique partia de
    // "tudo" e devolvia o campo vazio.
    expect(camposToken()[2].value).toBe("chave-frenet-ficticia");
  });

  it("duas falhas seguidas e depois sucesso: a chave colada continua lá", async () => {
    await renderizar(true);
    await digitar(camposToken()[1], "chave-superfrete-ficticia");

    await renderizar(false);
    edge.leituraFalha = true;
    await renderizar(true);
    expect(telaDeErro()).toBe(true);

    // 1º "Tentar de novo": a edge ainda está fora. O modo pendente não pode
    // ser perdido na segunda falha.
    await clicar(botoes(/^Tentar de novo$/)[0]);
    expect(telaDeErro()).toBe(true);

    edge.leituraFalha = false;
    await clicar(botoes(/^Tentar de novo$/)[0]);

    expect(telaDeErro()).toBe(false);
    expect(camposToken()[1].value).toBe("chave-superfrete-ficticia");
  });

  it("releitura que falha depois de salvar um provedor: só o dele volta limpo e destravado", async () => {
    await renderizar(true);
    await digitar(camposToken()[0], "chave-me-ficticia");
    await digitar(camposToken()[2], "chave-frenet-ficticia");

    // Salvar o Melhor Envio grava, mas a releitura logo depois falha.
    // (`salvarProvedor` usa o salvar do cartão; a leitura passa a falhar
    // antes do clique para que a segunda chamada à edge seja a que falha.)
    edge.leituraFalha = true;
    await clicar(botoes(/^Salvar transportadora$/)[0]);
    expect(telaDeErro()).toBe(true);

    edge.leituraFalha = false;
    await clicar(botoes(/^Tentar de novo$/)[0]);

    expect(telaDeErro()).toBe(false);
    // O provedor recém-salvo volta limpo (a chave já está gravada)...
    expect(camposToken()[0].value).toBe("");
    // ...e o botão dele não ficou preso em "Salvando…".
    expect(botoes(/^Salvando/)).toHaveLength(0);
    // O que a lojista ainda digitava em outro cartão continua.
    expect(camposToken()[2].value).toBe("chave-frenet-ficticia");
  });

  it("salvou, a releitura falhou e a volta à aba leu bem: o card sai de 'Salvando…' e a chave do outro fica", async () => {
    await renderizar(true);
    await digitar(camposToken()[0], "chave-me-ficticia");
    await digitar(camposToken()[2], "chave-frenet-ficticia");

    edge.leituraFalha = true;
    await clicar(botoes(/^Salvar transportadora$/)[0]);
    expect(telaDeErro()).toBe(true);

    // Sem tocar em "Tentar de novo": a lojista troca de aba e volta, e a
    // leitura (modo "nenhum") funciona. O pedido pendente do provedor salvo
    // tem de ser aplicado nessa leitura, senão o card fica preso.
    edge.leituraFalha = false;
    await renderizar(false);
    await renderizar(true);

    expect(telaDeErro()).toBe(false);
    expect(botoes(/^Salvando/)).toHaveLength(0);
    expect(camposToken()[0].value).toBe("");
    expect(camposToken()[2].value).toBe("chave-frenet-ficticia");
  });

  it("dois provedores salvos e as duas releituras falham: Tentar de novo não deixa nenhum em 'Salvando…' nem apaga o terceiro", async () => {
    await renderizar(true);
    await digitar(camposToken()[0], "chave-me-ficticia");
    await digitar(camposToken()[1], "chave-superfrete-ficticia");
    await digitar(camposToken()[2], "chave-frenet-ficticia");

    const salvar = botoes(/^Salvar transportadora$/);
    edge.leituraFalha = true;
    // Os dois salvamentos partem juntos (o segundo antes de a leitura do
    // primeiro voltar): a tela de erro ainda não substituiu os cartões.
    await act(async () => {
      salvar[0].click();
      salvar[2].click();
    });
    await assentar();
    expect(telaDeErro()).toBe(true);

    edge.leituraFalha = false;
    await clicar(botoes(/^Tentar de novo$/)[0]);

    expect(telaDeErro()).toBe(false);
    expect(botoes(/^Salvando/)).toHaveLength(0);
    // Os dois salvos voltam limpos...
    expect(camposToken()[0].value).toBe("");
    expect(camposToken()[2].value).toBe("");
    // ...e o que a lojista digitava no terceiro cartão continua.
    expect(camposToken()[1].value).toBe("chave-superfrete-ficticia");
  });

  it("carga inicial que falha e a volta à aba lê bem: o e-mail de contato vem do servidor", async () => {
    edge.leituraFalha = true;
    await renderizar(true);
    expect(telaDeErro()).toBe(true);

    edge.leituraFalha = false;
    await renderizar(false);
    await renderizar(true);

    expect(telaDeErro()).toBe(false);
    expect(camposEmail()[0].value).toBe("contato@exemplo.com");
  });

  it("carga inicial que falha continua partindo do zero, mesmo se a aba volta no meio", async () => {
    edge.leituraFalha = true;
    await renderizar(true);
    expect(telaDeErro()).toBe(true);

    // Volta à aba com a edge ainda fora: um pedido "nenhum" não pode rebaixar
    // o pedido "tudo" que a carga inicial deixou pendente.
    await renderizar(false);
    await renderizar(true);
    expect(telaDeErro()).toBe(true);

    edge.leituraFalha = false;
    await clicar(botoes(/^Tentar de novo$/)[0]);

    expect(telaDeErro()).toBe(false);
    // "tudo" popula o e-mail de contato com o que o servidor devolveu;
    // "nenhum" deixaria o campo vazio.
    expect(camposEmail()[0].value).toBe("contato@exemplo.com");
  });
});
