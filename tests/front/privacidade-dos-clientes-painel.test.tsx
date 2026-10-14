// @vitest-environment jsdom
//
// Painel do lojista, Ajustes > Minha loja > "Pedidos de privacidade dos clientes" (LGPD, 14/10/2026).
// A loja VÊ os pedidos, escreve uma resposta e marca "atendido" ou "não posso atender" — SEM botão de
// apagar. Aqui se prova a TELA e o que ela manda ao banco; quem protege de verdade (RLS, gatilho, ninguém
// apaga) é provado em tests/banco/pedidos-de-privacidade-viva.cjs.
import { PrivacidadeDosClientesSection } from "@/components/admin/settings/PrivacidadeDosClientesSection";
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

interface Resposta {
  data: unknown;
  error: unknown;
}

const banco = {
  lista: { data: [], error: null } as Resposta,
  listaDepois: null as Resposta | null,
  perfis: {
    data: [{ id: "cliente-1", full_name: "Maria Souza" }],
    error: null,
  } as Resposta,
  perfisQuebra: false,
  atualizacao: { data: [{ id: "ped-1" }], error: null } as Resposta,
  atualizacaoQuebra: null as unknown,
  leituras: 0,
  updates: [] as Array<{
    linha: Record<string, unknown>;
    filtros: unknown[][];
  }>,
  chamadas: [] as string[],
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      banco.chamadas.push(`from:${tabela}`);
      if (tabela === "profiles") {
        return {
          select: () => ({
            in: async () => {
              if (banco.perfisQuebra) throw new Error("rede");
              return banco.perfis;
            },
          }),
        };
      }
      return {
        select: () => ({
          order: () => ({
            limit: async () => {
              banco.leituras += 1;
              if (banco.leituras > 1 && banco.listaDepois) {
                return banco.listaDepois;
              }
              return banco.lista;
            },
          }),
        }),
        update: (linha: Record<string, unknown>) => {
          const filtros: unknown[][] = [];
          banco.chamadas.push("update");
          const cadeia = {
            eq: (coluna: string, valor: unknown) => {
              filtros.push([coluna, valor]);
              return cadeia;
            },
            select: async () => {
              banco.updates.push({ linha, filtros });
              if (banco.atualizacaoQuebra) throw banco.atualizacaoQuebra;
              return banco.atualizacao;
            },
          };
          return cadeia;
        },
        delete: () => {
          banco.chamadas.push("delete");
          throw new Error("o painel nunca apaga pedido de privacidade");
        },
      };
    },
  },
}));

function pedido(extra: Record<string, unknown> = {}) {
  return {
    id: "ped-1",
    user_id: "cliente-1",
    tipo: "excluir_conta",
    email_novo: null,
    situacao: "aberto",
    criado_em: new Date().toISOString(),
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

function digitar(campo: HTMLTextAreaElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PrivacidadeDosClientesSection", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onDirtyMudou = vi.fn();
  const onNavigate = vi.fn();

  beforeEach(() => {
    banco.lista = { data: [], error: null };
    banco.listaDepois = null;
    banco.perfis = {
      data: [{ id: "cliente-1", full_name: "Maria Souza" }],
      error: null,
    };
    banco.perfisQuebra = false;
    banco.atualizacao = { data: [{ id: "ped-1" }], error: null };
    banco.atualizacaoQuebra = null;
    banco.leituras = 0;
    banco.updates = [];
    banco.chamadas = [];
    onDirtyMudou.mockClear();
    onNavigate.mockClear();
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
        <PrivacidadeDosClientesSection
          onNavigate={onNavigate}
          onDirtyMudou={onDirtyMudou}
        />,
      );
    });
    await assentar();
  }

  it("sem pedido nenhum, diz que não há pedido e não mostra botão de decidir", async () => {
    await montar();
    expect(corpo()).toContain("Nenhum pedido de privacidade por enquanto.");
    expect(botao("Marcar como atendido")).toBeUndefined();
  });

  it("lista os pedidos abertos com o nome, o tipo, a data, o prazo e o e-mail pedido", async () => {
    banco.lista = {
      data: [
        pedido(),
        pedido({
          id: "ped-2",
          tipo: "corrigir_email",
          email_novo: "maria.nova@exemplo.com",
        }),
      ],
      error: null,
    };
    await montar();
    const texto = corpo();
    expect(texto).toContain("Esperando resposta (2)");
    expect(texto).toContain("Maria Souza");
    expect(texto).toContain("Responder até");
    expect(texto).toContain("maria.nova@exemplo.com");
    expect(
      hospedeiro.querySelectorAll("li[data-pedido-de-privacidade]"),
    ).toHaveLength(2);
  });

  it("nome que não veio de profiles vira 'Cliente' em vez de sumir o pedido", async () => {
    banco.lista = { data: [pedido()], error: null };
    banco.perfisQuebra = true;
    await montar();
    expect(corpo()).toContain("Cliente");
    expect(botao("Marcar como atendido")).toBeDefined();
  });

  it("pedido com prazo vencido avisa em vermelho que é para responder hoje", async () => {
    banco.lista = {
      data: [pedido({ criado_em: "2026-01-01T12:00:00Z" })],
      error: null,
    };
    await montar();
    expect(corpo()).toContain("Prazo vencido");
  });

  it("não existe botão de apagar, e o texto diz que é de propósito", async () => {
    banco.lista = { data: [pedido()], error: null };
    await montar();
    const rotulos = [...document.body.querySelectorAll("button")].map((b) =>
      (b.textContent ?? "").toLowerCase(),
    );
    for (const rotulo of rotulos) {
      expect(rotulo).not.toMatch(/apagar|excluir|deletar|remover/);
    }
    expect(corpo()).toContain("Não há botão de apagar de propósito.");
    expect(banco.chamadas).not.toContain("delete");
  });

  it("'Marcar como atendido' só ABRE a pergunta: nada é gravado até confirmar", async () => {
    banco.lista = { data: [pedido()], error: null };
    await montar();
    act(() => botao("Marcar como atendido")?.click());
    expect(dialogo()).not.toBeNull();
    expect(dialogo()?.textContent).toContain("Marcar como atendido?");
    expect(banco.updates).toHaveLength(0);
  });

  it("'Voltar' fecha a pergunta e NÃO grava", async () => {
    banco.lista = { data: [pedido()], error: null };
    await montar();
    act(() => botao("Marcar como atendido")?.click());
    act(() => botao("Voltar", dialogo() as HTMLElement)?.click());
    await assentar();
    expect(dialogo()).toBeNull();
    expect(banco.updates).toHaveLength(0);
  });

  it("confirmar grava 'atendido' com a nota, SÓ onde ainda está aberto, e relê a lista", async () => {
    banco.lista = { data: [pedido()], error: null };
    banco.listaDepois = {
      data: [
        pedido({
          situacao: "atendido",
          atendido_em: "2026-10-14T15:00:00Z",
          observacao: "Conta anonimizada.",
        }),
      ],
      error: null,
    };
    await montar();
    const campo = document.getElementById(
      "nota-privacidade-ped-1",
    ) as HTMLTextAreaElement;
    digitar(campo, "  Conta anonimizada.  ");
    act(() => botao("Marcar como atendido")?.click());
    await act(async () => {
      botao("Sim, já atendi", dialogo() as HTMLElement)?.click();
    });
    await assentar();

    expect(banco.updates).toHaveLength(1);
    expect(banco.updates[0].linha).toEqual({
      situacao: "atendido",
      observacao: "Conta anonimizada.",
    });
    expect(banco.updates[0].filtros).toEqual([
      ["id", "ped-1"],
      ["situacao", "aberto"],
    ]);
    expect(dialogo()).toBeNull();
    expect(corpo()).toContain("Já respondidos (1)");
    expect(corpo()).toContain("Conta anonimizada.");
    expect(botao("Marcar como atendido")).toBeUndefined();
  });

  it("'Não posso atender' grava 'recusado'; nota vazia vai como null", async () => {
    banco.lista = { data: [pedido()], error: null };
    await montar();
    act(() => botao("Não posso atender")?.click());
    await act(async () => {
      botao("Sim, não posso atender", dialogo() as HTMLElement)?.click();
    });
    await assentar();
    expect(banco.updates[0].linha).toEqual({
      situacao: "recusado",
      observacao: null,
    });
  });

  it("nota digitada e não salva avisa o pai para travar o fecho da seção", async () => {
    banco.lista = { data: [pedido()], error: null };
    await montar();
    expect(onDirtyMudou).toHaveBeenLastCalledWith(false);
    digitar(
      document.getElementById("nota-privacidade-ped-1") as HTMLTextAreaElement,
      "rascunho",
    );
    expect(onDirtyMudou).toHaveBeenLastCalledWith(true);
  });

  it("falha de rede ao salvar: mostra o erro honesto, mantém a pergunta e o pedido aberto", async () => {
    banco.lista = { data: [pedido()], error: null };
    banco.atualizacaoQuebra = new TypeError("Failed to fetch");
    await montar();
    act(() => botao("Marcar como atendido")?.click());
    await act(async () => {
      botao("Sim, já atendi", dialogo() as HTMLElement)?.click();
    });
    await assentar();
    expect(dialogo()?.textContent).toContain("Não consegui salvar a resposta.");
    expect(corpo()).toContain("Esperando resposta (1)");
  });

  it("pedido já decidido por outra pessoa (zero linha): avisa, fecha a pergunta e relê", async () => {
    banco.lista = { data: [pedido()], error: null };
    banco.listaDepois = {
      data: [
        pedido({ situacao: "atendido", atendido_em: "2026-10-14T15:00:00Z" }),
      ],
      error: null,
    };
    banco.atualizacao = { data: [], error: null };
    await montar();
    act(() => botao("Marcar como atendido")?.click());
    await act(async () => {
      botao("Sim, já atendi", dialogo() as HTMLElement)?.click();
    });
    await assentar();
    expect(dialogo()).toBeNull();
    expect(corpo()).toContain("Este pedido já tinha sido respondido");
    expect(corpo()).toContain("Já respondidos (1)");
  });

  it("gatilho do banco recusando (55000) é lido como 'já decidido', não como erro de rede", async () => {
    banco.lista = { data: [pedido()], error: null };
    banco.atualizacao = {
      data: null,
      error: { code: "55000", message: "decisao final" },
    };
    await montar();
    act(() => botao("Marcar como atendido")?.click());
    await act(async () => {
      botao("Sim, já atendi", dialogo() as HTMLElement)?.click();
    });
    await assentar();
    expect(corpo()).toContain("Este pedido já tinha sido respondido");
    expect(corpo()).not.toContain("Confira a internet");
  });

  it("leitura da lista que falha mostra o erro com 'Tentar de novo', que lê outra vez", async () => {
    banco.lista = { data: null, error: { code: "500", message: "caiu" } };
    await montar();
    expect(corpo()).toContain("Não consegui carregar os pedidos.");
    banco.lista = { data: [pedido()], error: null };
    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    await assentar();
    expect(corpo()).toContain("Esperando resposta (1)");
  });

  it("'Ver cliente' abre a ficha da cliente", async () => {
    banco.lista = { data: [pedido()], error: null };
    await montar();
    act(() => botao("Ver cliente")?.click());
    expect(onNavigate).toHaveBeenCalledWith("admin-user-detail", "cliente-1");
  });

  it("linha de forma estranha some da lista em vez de derrubar a tela", async () => {
    banco.lista = {
      data: [pedido(), { id: 5, tipo: "outra_coisa" }],
      error: null,
    };
    await montar();
    expect(
      hospedeiro.querySelectorAll("li[data-pedido-de-privacidade]"),
    ).toHaveLength(1);
  });
});
