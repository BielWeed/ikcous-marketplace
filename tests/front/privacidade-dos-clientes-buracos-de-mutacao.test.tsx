// @vitest-environment jsdom
//
// Buracos achados por caça de mutação em PrivacidadeDosClientesSection (os
// testes antigos passavam mesmo com o defeito de uma linha plantado):
//  - nota só de espaços não pode travar o fecho da seção;
//  - com uma decisão sendo gravada, Esc não fecha a pergunta (a lojista
//    poderia abrir outra decisão por cima da que ainda não terminou);
//  - os pedidos já respondidos aparecem do mais novo para o mais antigo,
//    mesmo que o servidor devolva em outra ordem;
//  - só o primeiro pedido aberto vem com o campo de resposta aberto;
//  - "Atendido" e "Não atendido" não se trocam na lista dos respondidos.
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

type Linha = Record<string, unknown>;

const banco = {
  lista: [] as Linha[],
  atualizacaoPendente: null as Promise<unknown> | null,
};

const valorDaColuna = (linha: Linha, nome: string): unknown =>
  new Map(Object.entries(linha)).get(nome);

// Devolve as linhas na ORDEM EM QUE FORAM GUARDADAS (ignora `order`), de
// propósito: a ordem dos respondidos que a lojista vê tem de ser a da tela.
function consultaDaLista() {
  const filtros: Array<(linha: Linha) => boolean> = [];
  const cadeia = {
    eq: (coluna: string, valor: unknown) => {
      filtros.push((l) => valorDaColuna(l, coluna) === valor);
      return cadeia;
    },
    neq: (coluna: string, valor: unknown) => {
      filtros.push((l) => valorDaColuna(l, coluna) !== valor);
      return cadeia;
    },
    order: () => cadeia,
    limit: () => cadeia,
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase, mesmo padrão dos vizinhos deste diretório.
    then: (
      resolve: (v: { data: Linha[]; error: null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) =>
      Promise.resolve({
        data: banco.lista.filter((l) => filtros.every((f) => f(l))),
        error: null,
      }).then(resolve, reject),
  };
  return cadeia;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "profiles") {
        return {
          select: () => ({
            in: async () => ({
              data: [{ id: "cliente-1", full_name: "Maria de Teste" }],
              error: null,
            }),
          }),
        };
      }
      return {
        select: () => consultaDaLista(),
        update: () => {
          const cadeia = {
            eq: () => cadeia,
            select: async () =>
              banco.atualizacaoPendente ?? { data: [{ id: "x" }], error: null },
          };
          return cadeia;
        },
      };
    },
  },
}));

function pedido(extra: Linha = {}): Linha {
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

const dialogo = () =>
  document.body.querySelector<HTMLElement>('[role="alertdialog"]');
const botao = (texto: string, dentro: ParentNode = document.body) =>
  [...dentro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    (b.textContent ?? "").includes(texto),
  );
const cartao = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `li[data-pedido-de-privacidade="${id}"]`,
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

describe("PrivacidadeDosClientesSection (buracos de mutação)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onDirtyMudou = vi.fn();

  beforeEach(() => {
    banco.lista = [];
    banco.atualizacaoPendente = null;
    onDirtyMudou.mockClear();
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
        <PrivacidadeDosClientesSection onDirtyMudou={onDirtyMudou} />,
      );
    });
    await assentar();
  }

  it("nota só de espaços e quebras de linha não conta como rascunho (não trava o fecho)", async () => {
    banco.lista = [pedido()];
    await montar();
    const campo = document.getElementById(
      "nota-privacidade-ped-1",
    ) as HTMLTextAreaElement;
    digitar(campo, "   \n  ");
    expect(onDirtyMudou).toHaveBeenLastCalledWith(false);
    digitar(campo, "   rascunho ");
    expect(onDirtyMudou).toHaveBeenLastCalledWith(true);
  });

  it("com a decisão sendo gravada, Esc não fecha a pergunta", async () => {
    banco.lista = [pedido()];
    banco.atualizacaoPendente = new Promise(() => {});
    await montar();
    act(() => botao("Marcar como atendido")?.click());
    await act(async () => {
      botao("Sim, já atendi", dialogo() as HTMLElement)?.click();
    });
    expect(botao("Voltar", dialogo() as HTMLElement)?.disabled).toBe(true);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(dialogo()).not.toBeNull();
    expect(dialogo()?.textContent).toContain("Salvando");
  });

  it("sem decisão em andamento, Esc fecha a pergunta e nada é gravado", async () => {
    banco.lista = [pedido()];
    await montar();
    act(() => botao("Marcar como atendido")?.click());
    expect(dialogo()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await assentar();
    expect(dialogo()).toBeNull();
  });

  it("respondidos aparecem do mais novo para o mais antigo, mesmo se o servidor mandar na ordem inversa", async () => {
    banco.lista = [
      pedido({
        id: "ped-antigo",
        situacao: "atendido",
        atendido_em: "2026-10-01T12:00:00Z",
        observacao: "resposta-antiga",
      }),
      pedido({
        id: "ped-novo",
        situacao: "recusado",
        atendido_em: "2026-11-20T12:00:00Z",
        observacao: "resposta-nova",
      }),
    ];
    await montar();
    const ids = [
      ...document.body.querySelectorAll<HTMLElement>(
        "li[data-pedido-de-privacidade]",
      ),
    ].map((li) => li.getAttribute("data-pedido-de-privacidade"));
    expect(ids).toEqual(["ped-novo", "ped-antigo"]);
  });

  it("'Atendido' e 'Não atendido' ficam no pedido certo da lista de respondidos", async () => {
    banco.lista = [
      pedido({
        id: "ped-sim",
        situacao: "atendido",
        atendido_em: "2026-10-01T12:00:00Z",
      }),
      pedido({
        id: "ped-nao",
        situacao: "recusado",
        atendido_em: "2026-10-02T12:00:00Z",
      }),
    ];
    await montar();
    const sim = cartao("ped-sim")?.textContent ?? "";
    const nao = cartao("ped-nao")?.textContent ?? "";
    expect(sim).toContain("Atendido · Respondido em");
    expect(sim).not.toContain("Não atendido");
    expect(nao).toContain("Não atendido · Respondido em");
  });

  it("só o primeiro pedido aberto vem com o campo de resposta aberto", async () => {
    banco.lista = [
      pedido({ id: "ped-a", criado_em: "2026-11-01T12:00:00Z" }),
      pedido({ id: "ped-b", criado_em: "2026-11-02T12:00:00Z" }),
    ];
    await montar();
    expect(cartao("ped-a")?.querySelector("details")?.open).toBe(true);
    expect(cartao("ped-b")?.querySelector("details")?.open).toBe(false);
  });
});
