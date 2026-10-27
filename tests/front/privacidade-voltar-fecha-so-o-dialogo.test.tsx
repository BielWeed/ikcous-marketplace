// @vitest-environment jsdom
//
// VOLTAR DO CELULAR COM A PERGUNTA DE PRIVACIDADE ABERTA ("Pedir a exclusão da
// sua conta?" e "Corrigir o e-mail"). O defeito: no Android, o Voltar tirava a
// cliente da tela da conta com a pergunta aberta (e o e-mail novo, já digitado,
// se perdia). Agora o Voltar fecha só a pergunta, como o botão "Voltar" dela:
// a tela da conta continua montada e nenhuma entrada de histórico sobra. Com o
// pedido sendo gravado (botões desligados), o Voltar NÃO fecha — a pergunta
// continua, e o Voltar seguinte ainda é dela.
//
// Histórico REAL do jsdom e um "App" simulado que só navega quando a tela do
// histórico muda. Molde de montagem: privacidade-e-meus-dados.test.tsx.
import { PrivacidadeEMeusDados } from "@/components/account/PrivacidadeEMeusDados";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const USER_ID = "cliente-1";
const EMAIL_ATUAL = "maria@exemplo.com";

const banco = {
  inserts: [] as Array<Record<string, unknown>>,
  // Enquanto houver uma promessa aqui, a gravação fica "em andamento".
  trava: null as Promise<void> | null,
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null }),
        }),
      }),
      insert: (linha: Record<string, unknown>) => {
        banco.inserts.push(linha);
        return {
          select: () => ({
            single: async () => {
              await banco.trava;
              return {
                data: {
                  id: "ped-1",
                  user_id: USER_ID,
                  tipo: linha.tipo,
                  email_novo: linha.email_novo ?? null,
                  situacao: "aberto",
                  criado_em: "2026-10-14T12:00:00Z",
                  atendido_em: null,
                  atendido_por: null,
                  observacao: null,
                },
                error: null,
              };
            },
          }),
        };
      },
    }),
  },
}));

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const dialogo = () =>
  document.body.querySelector<HTMLElement>('[role="alertdialog"]');
const botao = (texto: string, dentro: ParentNode = document.body) =>
  [...dentro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    (b.textContent ?? "").includes(texto),
  );

describe("PrivacidadeEMeusDados — o Voltar do celular fecha só a pergunta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let navegacoesDoApp: string[];
  const ouvintes: Array<(e: PopStateEvent) => void> = [];

  const telaDoHistorico = () =>
    `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

  beforeEach(() => {
    banco.inserts = [];
    banco.trava = null;
    globalThis.history.replaceState({ view: "profile" }, "", "/profile");
    globalThis.history.pushState(
      { view: "account-settings" },
      "",
      "/account-settings",
    );
    navegacoesDoApp = [];
    let telaMostrada = telaDoHistorico();
    const ouvinte = () => {
      const alvo = telaDoHistorico();
      if (alvo === telaMostrada) return;
      telaMostrada = alvo;
      navegacoesDoApp.push(alvo);
    };
    ouvintes.push(ouvinte);
    globalThis.addEventListener("popstate", ouvinte);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    for (const o of ouvintes.splice(0)) {
      globalThis.removeEventListener("popstate", o);
    }
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <PrivacidadeEMeusDados userId={USER_ID} emailAtual={EMAIL_ATUAL} />,
      );
      await esperar();
    });
  }

  async function tocar(el: HTMLElement | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      el?.click();
      await esperar(120);
    });
    // Dá tempo ao `history.back()` que o fechamento pede e ao retorno engolido.
    await act(async () => {
      await esperar(120);
    });
  }

  /** Aperta o Voltar do aparelho: histórico real do jsdom. */
  async function apertarVoltar() {
    await act(async () => {
      globalThis.history.back();
      await esperar(60);
    });
    await act(async () => {
      await esperar(120);
    });
  }

  const TELA = { view: "account-settings" };
  const MARCA = { folhaDePolitica: true };

  it("abrir a pergunta empurra UMA entrada com o mesmo endereço da conta", async () => {
    await montar();
    const antes = globalThis.history.length;
    await tocar(botao("Pedir exclusão da minha conta"));
    expect(dialogo()).not.toBeNull();
    expect(globalThis.history.length).toBe(antes + 1);
    expect(globalThis.location.pathname).toBe("/account-settings");
    expect(globalThis.history.state).toMatchObject({ ...TELA, ...MARCA });
  });

  it("Voltar com a pergunta de exclusão aberta: fecha só ela, nada é gravado e a conta fica", async () => {
    await montar();
    await tocar(botao("Pedir exclusão da minha conta"));
    await apertarVoltar();

    expect(dialogo()).toBeNull();
    expect(banco.inserts).toHaveLength(0);
    expect(botao("Pedir exclusão da minha conta")).toBeDefined();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual(TELA);
    // O Voltar seguinte já é do roteador.
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["profile|/profile"]);
  });

  it("Voltar com a pergunta do e-mail aberta: fecha só ela", async () => {
    await montar();
    await tocar(botao("Corrigir meu e-mail"));
    expect(dialogo()?.textContent).toContain("e-mail");
    await apertarVoltar();

    expect(dialogo()).toBeNull();
    expect(banco.inserts).toHaveLength(0);
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual(TELA);
  });

  it("fechar pelo botão 'Voltar' da pergunta consome a entrada: a tela não recua", async () => {
    await montar();
    await tocar(botao("Pedir exclusão da minha conta"));
    await tocar(botao("Voltar", dialogo() as HTMLElement));

    expect(dialogo()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual(TELA);
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["profile|/profile"]);
  });

  it("confirmar o pedido fecha a pergunta e consome a entrada: a tela não recua", async () => {
    await montar();
    await tocar(botao("Pedir exclusão da minha conta"));
    await tocar(botao("Sim, pedir exclusão", dialogo() as HTMLElement));

    expect(banco.inserts).toHaveLength(1);
    expect(dialogo()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual(TELA);
  });

  it("com o pedido sendo gravado, o Voltar NÃO fecha a pergunta e a entrada volta", async () => {
    let soltar: () => void = () => {};
    banco.trava = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    await montar();
    await tocar(botao("Pedir exclusão da minha conta"));
    await tocar(botao("Sim, pedir exclusão", dialogo() as HTMLElement));
    expect(banco.inserts).toHaveLength(1);

    await apertarVoltar();
    // Gravando: a pergunta continua, a tela não saiu, a entrada foi devolvida.
    expect(dialogo()).not.toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toMatchObject({ ...TELA, ...MARCA });
    await apertarVoltar();
    expect(dialogo()).not.toBeNull();
    expect(navegacoesDoApp).toEqual([]);

    // Terminou de gravar: a pergunta fecha e a entrada é consumida.
    await act(async () => {
      soltar();
      await esperar(150);
    });
    await act(async () => {
      await esperar(150);
    });
    expect(dialogo()).toBeNull();
    expect(globalThis.history.state).toEqual(TELA);
    expect(navegacoesDoApp).toEqual([]);
  });
});
