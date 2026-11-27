// @vitest-environment jsdom
//
// Caça 27/11 — dois aparelhos na tela de Frete. O celular abriu a tela com só
// a SuperFrete ligada; no computador a lojista ligou o Melhor Envio e salvou;
// no celular, SEM sair da tela, ela liga a Frenet e salva. Antes o cartão
// mandava só a lista local inteira (SF+Frenet) e o servidor a gravava por
// cima: o Melhor Envio era DESLIGADO sem aviso. Agora o cartão manda também a
// lista que ele VIU (`ligadosVistos`); a edge recusa com
// `motivo:'ligados_mudaram'` quando ela não bate com o banco, e o cartão relê,
// avisa em português e reaplica a escolha da lojista por cima da lista nova.
//
// Tokens e e-mails abaixo são FICTÍCIOS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      throw new Error("a seção não lê o banco direto");
    },
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: () => undefined,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVISO =
  "As transportadoras foram mudadas em outro aparelho. Conferimos a lista de novo — revise e salve outra vez.";

function leitura(ligados: string[]) {
  return {
    success: true,
    modo: "multi",
    ligados,
    provedores: {
      superfrete: {
        tem_chave: true,
        sandbox: false,
        servicos: null,
        contato_email: "contato@loja-ficticia.com.br",
      },
      melhor_envio: {
        tem_chave: true,
        sandbox: false,
        servicos: null,
        seguro: "valor_dos_produtos",
        contato_email: "contato@loja-ficticia.com.br",
      },
      frenet: { tem_chave: true, sandbox: false, servicos: null },
    },
  };
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TransportadorasSection — a lista mudou em outro aparelho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function assentar() {
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await esperarMicrotarefas();
      });
    }
  }

  async function abrir() {
    const { TransportadorasSection } = await import(
      "./apoio/transportadoras-isoladas"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    await assentar();
  }

  const caixa = (nome: string) =>
    hospedeiro.querySelector<HTMLButtonElement>(`[aria-label="Ligar ${nome}"]`);
  const marcada = (nome: string) =>
    caixa(nome)?.getAttribute("aria-checked") === "true";
  const salvar = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      /Salvar provedores/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;

  async function clicar(b: HTMLElement | null | undefined) {
    expect(b).toBeTruthy();
    await act(async () => {
      b?.click();
    });
    await assentar();
  }

  const corposDoSalvar = () =>
    invoke.mock.calls
      .filter((c: any[]) => c[1]?.body?.action === "save_active_providers")
      .map((c: any[]) => c[1].body);
  const leiturasFeitas = () =>
    invoke.mock.calls.filter(
      (c: any[]) => c[1]?.body?.action === "ler_configuracao_frete",
    ).length;

  it("o envio leva a lista VISTA; na recusa relê, avisa e mantém a escolha da lojista por cima da lista nova", async () => {
    // O banco, visto pelo celular: só a SuperFrete.
    let noBanco = ["superfrete"];
    invoke.mockImplementation((_n: string, opcoes: any) => {
      const body = opcoes?.body;
      if (body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: leitura(noBanco), error: null });
      }
      if (body?.action === "save_active_providers") {
        const atual = [...noBanco].sort().join(",");
        const vistos = [...(body.ligadosVistos ?? [])].sort().join(",");
        if (body.ligadosVistos && vistos !== atual) {
          return Promise.resolve({
            data: {
              success: false,
              motivo: "ligados_mudaram",
              error: "texto do servidor",
            },
            error: null,
          });
        }
        noBanco = body.ligados;
        return Promise.resolve({
          data: { success: true, ligados: body.ligados },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });

    await abrir();
    expect(marcada("SuperFrete")).toBe(true);
    expect(marcada("Melhor Envio")).toBe(false);

    // No computador, o Melhor Envio foi ligado e salvo.
    noBanco = ["superfrete", "melhor_envio"];

    // No celular, sem reler: liga a Frenet e salva.
    await clicar(caixa("Frenet"));
    const leiturasAntes = leiturasFeitas();
    await clicar(salvar());

    const [primeiro] = corposDoSalvar();
    expect(primeiro).toEqual({
      action: "save_active_providers",
      ligados: ["superfrete", "frenet"],
      ligadosVistos: ["superfrete"],
    });
    // O Melhor Envio NÃO foi desligado no banco.
    expect(noBanco).toEqual(["superfrete", "melhor_envio"]);

    // Releu a lista do servidor e avisou, escrito no bloco e no toast.
    expect(leiturasFeitas()).toBe(leiturasAntes + 1);
    const alerta = [...hospedeiro.querySelectorAll('[role="alert"]')].map(
      (el) => el.textContent,
    );
    expect(alerta.some((t) => t?.includes(AVISO))).toBe(true);
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(AVISO);
    expect(toast.success).not.toHaveBeenCalled();

    // A escolha dela (ligar a Frenet) continua na tela, agora por cima da
    // lista nova — o Melhor Envio do outro aparelho aparece ligado.
    expect(marcada("SuperFrete")).toBe(true);
    expect(marcada("Melhor Envio")).toBe(true);
    expect(marcada("Frenet")).toBe(true);

    // Salvar de novo leva a lista nova como vista e grava as três.
    await clicar(salvar());
    const segundo = corposDoSalvar()[1];
    expect(segundo).toEqual({
      action: "save_active_providers",
      ligados: ["superfrete", "melhor_envio", "frenet"],
      ligadosVistos: ["superfrete", "melhor_envio"],
    });
    expect(noBanco).toEqual(["superfrete", "melhor_envio", "frenet"]);
  });

  it("a recusa respeita o que a lojista DESLIGOU: ela tirou a SF, o outro aparelho ligou o ME -> fica só o ME marcado", async () => {
    let noBanco = ["superfrete"];
    invoke.mockImplementation((_n: string, opcoes: any) => {
      const body = opcoes?.body;
      if (body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: leitura(noBanco), error: null });
      }
      if (body?.action === "save_active_providers") {
        return Promise.resolve({
          data: { success: false, motivo: "ligados_mudaram", error: "x" },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    noBanco = ["superfrete", "melhor_envio"];
    await clicar(caixa("SuperFrete"));
    await clicar(salvar());
    expect(marcada("SuperFrete")).toBe(false);
    expect(marcada("Melhor Envio")).toBe(true);
    expect(marcada("Frenet")).toBe(false);
  });

  it("releitura no MEIO da edição (sair e voltar ao Frete) reaplica a escolha por cima da lista nova — não desliga o que o outro aparelho ligou", async () => {
    // Caça de regressão 27/11: a releitura atualizava a lista VISTA mas
    // deixava a escolha pendente intacta; o salvar seguinte passava na
    // conferência da edge e desligava o Melhor Envio sem aviso.
    let noBanco = ["superfrete"];
    invoke.mockImplementation((_n: string, opcoes: any) => {
      const body = opcoes?.body;
      if (body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: leitura(noBanco), error: null });
      }
      if (body?.action === "save_active_providers") {
        const atual = [...noBanco].sort().join(",");
        const vistos = [...(body.ligadosVistos ?? [])].sort().join(",");
        if (body.ligadosVistos && vistos !== atual) {
          return Promise.resolve({
            data: { success: false, motivo: "ligados_mudaram", error: "x" },
            error: null,
          });
        }
        noBanco = body.ligados;
        return Promise.resolve({
          data: { success: true, ligados: body.ligados },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    const { TransportadorasSection } = await import(
      "./apoio/transportadoras-isoladas"
    );
    const montar = async (active: boolean) => {
      await act(async () => {
        raiz.render(<TransportadorasSection active={active} />);
      });
      await assentar();
    };
    await montar(true);
    expect(marcada("SuperFrete")).toBe(true);

    // No celular ela DESLIGA a SuperFrete, sem salvar ainda.
    await clicar(caixa("SuperFrete"));
    expect(marcada("SuperFrete")).toBe(false);

    // No computador, o Melhor Envio foi ligado.
    noBanco = ["superfrete", "melhor_envio"];

    // Ela sai da aba do Frete e volta: a tela relê do servidor.
    const leiturasAntes = leiturasFeitas();
    await montar(false);
    await montar(true);
    expect(leiturasFeitas()).toBe(leiturasAntes + 1);

    // A escolha dela (tirar a SF) continua; o ME do outro aparelho aparece.
    expect(marcada("SuperFrete")).toBe(false);
    expect(marcada("Melhor Envio")).toBe(true);
    expect(marcada("Frenet")).toBe(false);

    await clicar(salvar());
    expect(corposDoSalvar()[0]).toEqual({
      action: "save_active_providers",
      ligados: ["melhor_envio"],
      ligadosVistos: ["superfrete", "melhor_envio"],
    });
    expect(noBanco).toEqual(["melhor_envio"]);
  });

  it("depois de um salvar BEM-sucedido, a próxima ida leva como vista a lista que o servidor confirmou", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      const body = opcoes?.body;
      if (body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: leitura(["superfrete"]), error: null });
      }
      if (body?.action === "save_active_providers") {
        return Promise.resolve({
          data: { success: true, ligados: body.ligados },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(caixa("Frenet"));
    await clicar(salvar());
    await clicar(caixa("Melhor Envio"));
    await clicar(salvar());
    expect(corposDoSalvar().map((b) => b.ligadosVistos)).toEqual([
      ["superfrete"],
      ["superfrete", "frenet"],
    ]);
  });
});
