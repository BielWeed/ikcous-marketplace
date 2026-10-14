// @vitest-environment jsdom
//
// "Privacidade e meus dados" (LGPD, 14/10/2026): a cliente pede a exclusão da conta ou a correção do e-mail.
// O app só REGISTRA o pedido (tabela pedidos_de_privacidade); a loja atende à mão. Aqui se prova a TELA:
// texto, confirmação antes de gravar, e-mail validado, estado "pedido enviado", erro de rede honesto, pedido
// duplicado e acessibilidade básica. O banco (RLS, índice único, ninguém apaga) é provado em
// tests/banco/pedidos-de-privacidade-viva.cjs.
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

interface Resposta {
  data: unknown;
  error: unknown;
}

// O que o "banco" responde. Cada teste troca o que precisa.
const banco = {
  lista: { data: [], error: null } as Resposta,
  listaDepois: null as Resposta | null,
  insercao: { data: null, error: null } as Resposta,
  insercaoQuebra: null as unknown,
  leituras: 0,
  inserts: [] as Array<Record<string, unknown>>,
  todasAsChamadas: [] as string[],
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      banco.todasAsChamadas.push(`from:${tabela}`);
      return {
        select: () => ({
          eq: () => ({
            order: async () => {
              banco.leituras += 1;
              if (banco.leituras > 1 && banco.listaDepois) {
                return banco.listaDepois;
              }
              return banco.lista;
            },
          }),
        }),
        insert: (linha: Record<string, unknown>) => {
          banco.inserts.push(linha);
          banco.todasAsChamadas.push("insert");
          return {
            select: () => ({
              single: async () => {
                if (banco.insercaoQuebra) throw banco.insercaoQuebra;
                return banco.insercao;
              },
            }),
          };
        },
        delete: () => {
          banco.todasAsChamadas.push("delete");
          throw new Error("a tela da cliente nunca apaga");
        },
      };
    },
  },
}));

function pedido(extra: Record<string, unknown> = {}) {
  return {
    id: "ped-1",
    user_id: USER_ID,
    tipo: "excluir_conta",
    email_novo: null,
    situacao: "aberto",
    criado_em: "2026-10-14T12:00:00Z",
    atendido_em: null,
    atendido_por: null,
    observacao: null,
    ...extra,
  };
}

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const corpo = () => document.body.textContent ?? "";
const dialogo = () =>
  document.body.querySelector<HTMLElement>('[role="alertdialog"]');
const botao = (texto: string, dentro: ParentNode = document.body) =>
  [...dentro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    (b.textContent ?? "").includes(texto),
  );

function digitar(campo: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PrivacidadeEMeusDados", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    banco.lista = { data: [], error: null };
    banco.listaDepois = null;
    banco.insercao = { data: null, error: null };
    banco.insercaoQuebra = null;
    banco.leituras = 0;
    banco.inserts = [];
    banco.todasAsChamadas = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  async function montar() {
    act(() => {
      raiz.render(
        <PrivacidadeEMeusDados userId={USER_ID} emailAtual={EMAIL_ATUAL} />,
      );
    });
    await assentar();
  }

  it("mostra o que a loja guarda, o que a exclusão apaga, o que fica por lei e o prazo, em português simples", async () => {
    await montar();
    const texto = corpo();
    expect(texto).toContain("Privacidade e meus dados");
    expect(texto).toContain("O que a loja guarda de você");
    for (const item of [
      "Seu nome",
      "Seu telefone",
      "Seus endereços",
      "Seus favoritos",
      "Os avisos guardados neste aparelho",
    ]) {
      expect(texto).toContain(item);
    }
    expect(texto).toContain("O que fica guardado por lei");
    expect(texto).toContain(
      "Os pedidos e as notas fiscais ficam guardados, mas sem o seu nome depois da exclusão.",
    );
    expect(texto).toContain("A loja responde em até 15 dias.");
    expect(botao("Pedir exclusão da minha conta")).toBeDefined();
    expect(botao("Corrigir meu e-mail")).toBeDefined();
  });

  it("acessibilidade: a seção tem título ligado, e os dois botões têm no mínimo 44 px de altura", async () => {
    await montar();
    const secao = hospedeiro.querySelector("section");
    expect(secao?.getAttribute("aria-labelledby")).toBe("privacidade-titulo");
    expect(document.getElementById("privacidade-titulo")?.tagName).toBe("H2");
    for (const rotulo of [
      "Pedir exclusão da minha conta",
      "Corrigir meu e-mail",
    ]) {
      expect(botao(rotulo)?.className).toContain("min-h-11");
    }
  });

  it("tocar em 'Pedir exclusão' só ABRE a pergunta: nada é gravado até confirmar", async () => {
    await montar();
    act(() => botao("Pedir exclusão da minha conta")?.click());
    expect(dialogo()).not.toBeNull();
    expect(dialogo()?.textContent).toContain("Pedir a exclusão da sua conta?");
    expect(banco.inserts).toHaveLength(0);
  });

  it("'Voltar' fecha a pergunta e NÃO grava", async () => {
    await montar();
    act(() => botao("Pedir exclusão da minha conta")?.click());
    act(() => botao("Voltar", dialogo() as HTMLElement)?.click());
    await assentar();
    expect(dialogo()).toBeNull();
    expect(banco.inserts).toHaveLength(0);
    expect(botao("Pedir exclusão da minha conta")).toBeDefined();
  });

  it("confirmar a exclusão grava UM pedido (sem e-mail), fecha a pergunta e mostra a data e o prazo", async () => {
    banco.insercao = { data: pedido(), error: null };
    await montar();
    act(() => botao("Pedir exclusão da minha conta")?.click());
    await act(async () => {
      botao("Sim, pedir exclusão", dialogo() as HTMLElement)?.click();
    });
    await assentar();
    expect(banco.inserts).toEqual([
      { user_id: USER_ID, tipo: "excluir_conta", email_novo: null },
    ]);
    expect(dialogo()).toBeNull();
    expect(corpo()).toContain(
      "Pedido enviado em 14/10/2026 — a loja responde em até 15 dias.",
    );
    // Pedido aberto: não há como pedir de novo por aqui.
    expect(botao("Pedir exclusão da minha conta")).toBeUndefined();
  });

  it("e-mail vazio, sem formato ou igual ao atual: mostra o motivo ao lado do campo, mantém a pergunta aberta e NÃO grava", async () => {
    await montar();
    act(() => botao("Corrigir meu e-mail")?.click());
    const campo = document.getElementById(
      "privacidade-email-novo",
    ) as HTMLInputElement;
    expect(campo).not.toBeNull();
    expect(
      document.querySelector('label[for="privacidade-email-novo"]'),
    ).not.toBeNull();

    const enviar = () =>
      act(() => botao("Enviar pedido", dialogo() as HTMLElement)?.click());

    enviar();
    expect(corpo()).toContain("Digite o e-mail novo.");
    expect(campo.getAttribute("aria-invalid")).toBe("true");

    digitar(campo, "semarroba.com");
    enviar();
    expect(corpo()).toContain("Esse e-mail não parece certo.");

    digitar(campo, "  MARIA@exemplo.com ");
    enviar();
    expect(corpo()).toContain("Esse já é o e-mail da sua conta.");

    expect(banco.inserts).toHaveLength(0);
    expect(dialogo()).not.toBeNull();
  });

  it("e-mail novo válido grava o pedido com o e-mail limpo e em minúscula, e a tela mostra o e-mail pedido", async () => {
    banco.insercao = {
      data: pedido({
        id: "ped-2",
        tipo: "corrigir_email",
        email_novo: "maria.nova@exemplo.com",
      }),
      error: null,
    };
    await montar();
    act(() => botao("Corrigir meu e-mail")?.click());
    digitar(
      document.getElementById("privacidade-email-novo") as HTMLInputElement,
      "  Maria.Nova@Exemplo.com ",
    );
    await act(async () => {
      botao("Enviar pedido", dialogo() as HTMLElement)?.click();
    });
    await assentar();
    expect(banco.inserts).toEqual([
      {
        user_id: USER_ID,
        tipo: "corrigir_email",
        email_novo: "maria.nova@exemplo.com",
      },
    ]);
    expect(dialogo()).toBeNull();
    expect(corpo()).toContain("Pedido enviado em 14/10/2026");
    expect(corpo()).toContain("maria.nova@exemplo.com");
    expect(botao("Corrigir meu e-mail")).toBeUndefined();
  });

  it("sem rede: diz com franqueza que o pedido NÃO foi enviado, mantém a pergunta aberta e não finge sucesso", async () => {
    banco.insercaoQuebra = new TypeError("Failed to fetch");
    await montar();
    act(() => botao("Pedir exclusão da minha conta")?.click());
    await act(async () => {
      botao("Sim, pedir exclusão", dialogo() as HTMLElement)?.click();
    });
    await assentar();
    expect(dialogo()?.textContent).toContain("Seu pedido não foi enviado.");
    expect(corpo()).not.toContain("Pedido enviado em");
    // Dá para tentar de novo, e o botão voltou a funcionar.
    const confirmar = botao("Sim, pedir exclusão", dialogo() as HTMLElement);
    expect(confirmar?.disabled).toBe(false);
  });

  it("erro do servidor sem código (resposta de erro de rede do SDK) também é tratado como falta de conexão", async () => {
    banco.insercao = {
      data: null,
      error: { message: "TypeError: Failed to fetch" },
    };
    await montar();
    act(() => botao("Pedir exclusão da minha conta")?.click());
    await act(async () => {
      botao("Sim, pedir exclusão", dialogo() as HTMLElement)?.click();
    });
    await assentar();
    expect(dialogo()?.textContent).toContain("Sem conexão agora.");
    expect(corpo()).not.toContain("Pedido enviado em");
  });

  it("pedido duplicado (já existe um aberto, 23505): relê a lista, fecha a pergunta e mostra o pedido que já existe", async () => {
    banco.insercao = {
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    };
    // Na 1ª leitura não havia nada (outra aba criou depois); na releitura, há.
    banco.listaDepois = { data: [pedido()], error: null };
    await montar();
    act(() => botao("Pedir exclusão da minha conta")?.click());
    await act(async () => {
      botao("Sim, pedir exclusão", dialogo() as HTMLElement)?.click();
    });
    await assentar();
    expect(banco.leituras).toBe(2);
    expect(dialogo()).toBeNull();
    expect(corpo()).toContain("Você já tem um pedido igual esperando resposta");
    expect(corpo()).toContain("Pedido enviado em 14/10/2026");
    expect(botao("Pedir exclusão da minha conta")).toBeUndefined();
  });

  it("pedido que já estava aberto na carga aparece como enviado, sem botão para pedir de novo", async () => {
    banco.lista = {
      data: [
        pedido({
          id: "ped-3",
          tipo: "corrigir_email",
          email_novo: "outro@exemplo.com",
        }),
      ],
      error: null,
    };
    await montar();
    expect(corpo()).toContain(
      "Pedido enviado em 14/10/2026 — a loja responde em até 15 dias.",
    );
    expect(botao("Corrigir meu e-mail")).toBeUndefined();
    // O outro tipo continua disponível.
    expect(botao("Pedir exclusão da minha conta")).toBeDefined();
  });

  it("pedido recusado mostra a resposta da loja e deixa pedir de novo", async () => {
    banco.lista = {
      data: [
        pedido({
          situacao: "recusado",
          atendido_em: "2026-10-16T12:00:00Z",
          observacao: "Você tem um pedido em andamento. Fale com a loja.",
        }),
      ],
      error: null,
    };
    await montar();
    expect(corpo()).toContain("não pôde atendê-lo");
    expect(corpo()).toContain(
      "Resposta da loja: Você tem um pedido em andamento. Fale com a loja.",
    );
    expect(botao("Pedir exclusão da minha conta")).toBeDefined();
  });

  it("exclusão atendida encerra: mostra o fato e não oferece pedir de novo", async () => {
    banco.lista = {
      data: [
        pedido({ situacao: "atendido", atendido_em: "2026-10-20T12:00:00Z" }),
      ],
      error: null,
    };
    await montar();
    expect(corpo()).toContain("Pedido atendido pela loja em 20/10/2026.");
    expect(botao("Pedir exclusão da minha conta")).toBeUndefined();
  });

  it("falha ao carregar: avisa, NÃO oferece os botões de pedir e deixa tentar de novo", async () => {
    banco.lista = { data: null, error: { code: "08006", message: "x" } };
    await montar();
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não conseguimos ver se você já fez algum pedido.",
    );
    expect(botao("Pedir exclusão da minha conta")).toBeUndefined();
    expect(botao("Corrigir meu e-mail")).toBeUndefined();

    banco.lista = { data: [], error: null };
    await act(async () => {
      botao("Ver de novo meus pedidos")?.click();
    });
    await assentar();
    expect(botao("Pedir exclusão da minha conta")).toBeDefined();
  });

  it("a tela da cliente nunca apaga nada: nenhuma chamada de delete em nenhum fluxo", async () => {
    banco.insercao = { data: pedido(), error: null };
    await montar();
    act(() => botao("Pedir exclusão da minha conta")?.click());
    await act(async () => {
      botao("Sim, pedir exclusão", dialogo() as HTMLElement)?.click();
    });
    await assentar();
    expect(banco.todasAsChamadas).not.toContain("delete");
  });
});
