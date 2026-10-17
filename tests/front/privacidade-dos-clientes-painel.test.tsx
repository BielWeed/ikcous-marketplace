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

type Linha = Record<string, unknown>;

// Leitura de coluna por nome sem índice dinâmico (o eslint de segurança barra `linha[coluna]`).
const valorDaColuna = (linha: Linha, nome: string): unknown =>
  new Map(Object.entries(linha)).get(nome);

/** Query builder da lista: filtros `eq`/`neq`, `order` e `limit` sobre `banco.lista`. */
function consultaDaLista() {
  const filtros: Array<(linha: Linha) => boolean> = [];
  let ordem: { coluna: string; ascendente: boolean } | null = null;
  let limite = Number.POSITIVE_INFINITY;
  let ehConsultaDeAbertos = false;
  const cadeia = {
    eq: (coluna: string, valor: unknown) => {
      if (coluna === "situacao" && valor === "aberto") {
        ehConsultaDeAbertos = true;
      }
      filtros.push((l) => valorDaColuna(l, coluna) === valor);
      return cadeia;
    },
    neq: (coluna: string, valor: unknown) => {
      filtros.push((l) => valorDaColuna(l, coluna) !== valor);
      return cadeia;
    },
    order: (coluna: string, opcoes?: { ascending?: boolean }) => {
      ordem = { coluna, ascendente: opcoes?.ascending !== false };
      return cadeia;
    },
    limit: (n: number) => {
      limite = n;
      return cadeia;
    },
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase — mesmo padrão dos vizinhos deste diretório.
    then: (
      resolve: (v: Resposta) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      // A releitura conta uma vez por rodada (a consulta dos ABERTOS abre a rodada).
      if (ehConsultaDeAbertos) banco.leituras += 1;
      const base =
        banco.leituras > 1 && banco.listaDepois
          ? banco.listaDepois
          : banco.lista;
      if (base.error || !Array.isArray(base.data)) {
        return Promise.resolve(base).then(resolve, reject);
      }
      let linhas = (base.data as Linha[]).filter((l) =>
        filtros.every((f) => f(l)),
      );
      if (ordem) {
        const { coluna, ascendente } = ordem;
        linhas = [...linhas].sort((a, b) => {
          const va = String(valorDaColuna(a, coluna) ?? "");
          const vb = String(valorDaColuna(b, coluna) ?? "");
          return ascendente ? va.localeCompare(vb) : vb.localeCompare(va);
        });
      }
      return Promise.resolve({
        data: linhas.slice(0, limite),
        error: null,
      }).then(resolve, reject);
    },
  };
  return cadeia;
}

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
        // Um "banco" de verdade em miniatura: aplica filtro, ordem e limite às
        // linhas de `banco.lista`. Sem isso, um teste de "pedido novo some da
        // lista" passaria mesmo com a consulta errada.
        select: () => consultaDaLista(),
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

  it("com mais de 200 pedidos já respondidos, o pedido ABERTO novo continua na lista", async () => {
    // O defeito que este teste guarda: uma lista só, do mais antigo ao mais
    // novo e cortada em 201, empurrava justamente o pedido aberto mais novo
    // para fora da tela — a loja nunca o via e o prazo corria.
    const respondidos = Array.from({ length: 250 }, (_, i) => {
      const dia = String((i % 28) + 1).padStart(2, "0");
      const mes = String(Math.floor(i / 28) + 1).padStart(2, "0");
      return pedido({
        id: `resp-${String(i).padStart(3, "0")}`,
        user_id: `cli-${i}`,
        situacao: "atendido",
        criado_em: `2025-${mes}-${dia}T10:00:00Z`,
        atendido_em: `2025-${mes}-${dia}T12:00:00Z`,
      });
    });
    const novo = pedido({
      id: "aberto-novo",
      user_id: "cliente-novo",
      criado_em: "2026-10-14T09:00:00Z",
    });
    banco.lista = { data: [...respondidos, novo], error: null };
    await montar();

    expect(corpo()).toContain("Esperando resposta (1)");
    expect(
      hospedeiro.querySelector('li[data-pedido-de-privacidade="aberto-novo"]'),
    ).not.toBeNull();
    // Só os respondidos têm limite, e a tela diz que cortou.
    expect(corpo()).toContain(
      "Já respondidos · 200 carregados · lista incompleta",
    );
    expect(corpo()).toContain(
      "Há mais pedidos já respondidos do que cabem aqui",
    );
    // Os respondidos vêm do mais novo ao mais antigo: o de data mais recente está lá.
    expect(
      hospedeiro.querySelector('li[data-pedido-de-privacidade="resp-249"]'),
    ).not.toBeNull();
  });

  it("todos os pedidos abertos aparecem, do mais antigo (mais urgente) ao mais novo", async () => {
    banco.lista = {
      data: [
        pedido({ id: "b", user_id: "u2", criado_em: "2026-10-12T10:00:00Z" }),
        pedido({ id: "a", user_id: "u1", criado_em: "2026-10-10T10:00:00Z" }),
        pedido({ id: "c", user_id: "u3", criado_em: "2026-10-13T10:00:00Z" }),
      ],
      error: null,
    };
    await montar();
    const ids = [
      ...hospedeiro.querySelectorAll("li[data-pedido-de-privacidade]"),
    ].map((li) => li.getAttribute("data-pedido-de-privacidade"));
    expect(ids).toEqual(["a", "b", "c"]);
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

  it("filtros têm seleção explícita e mostram o vazio da lista escolhida", async () => {
    banco.lista = { data: [pedido()], error: null };
    await montar();
    const filtros = hospedeiro.querySelector(
      '[aria-label="Filtrar pedidos de privacidade"]',
    )!;
    const esperando = botao("Esperando resposta (1)", filtros)!;
    const respondidos = botao("Já respondidos (0)", filtros)!;
    expect(esperando.getAttribute("aria-pressed")).toBe("true");
    act(() => respondidos.click());
    expect(respondidos.getAttribute("aria-pressed")).toBe("true");
    expect(esperando.getAttribute("aria-pressed")).toBe("false");
    expect(corpo()).toContain("Nenhum pedido respondido por enquanto.");
    expect(
      hospedeiro
        .querySelector("li[data-pedido-de-privacidade]")
        ?.closest("[hidden]"),
    ).not.toBeNull();
    expect(banco.updates).toHaveLength(0);
  });

  it("contagem parcial é qualificada e o aviso vem antes dos filtros", async () => {
    banco.lista = {
      data: Array.from({ length: 201 }, (_, i) =>
        pedido({
          id: `resp-${i}`,
          situacao: "atendido",
          atendido_em: "2026-10-14T15:00:00Z",
        }),
      ),
      error: null,
    };
    await montar();
    const filtros = hospedeiro.querySelector(
      '[aria-label="Filtrar pedidos de privacidade"]',
    )!;
    expect(filtros.textContent).toContain(
      "Já respondidos · 200 carregados · lista incompleta",
    );
    expect(filtros.textContent).not.toContain("Já respondidos (200)");
    const aviso = [...hospedeiro.querySelectorAll('[role="status"]')].find(
      (el) => el.textContent?.includes("Lista incompleta"),
    )!;
    expect(
      aviso.compareDocumentPosition(filtros) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(botao("Tentar de novo", aviso)).toBeDefined();
  });
});
