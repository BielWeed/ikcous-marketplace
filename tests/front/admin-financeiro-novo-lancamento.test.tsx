// @vitest-environment jsdom
//
// Financeiro — folha "Novo lançamento": valida ANTES de chamar
// `fin_lancamento_salvar` (nada vai ao banco com campo faltando), manda o
// corpo do contrato do plano (valor em reais lido do "1.234,56" pt-BR,
// previsto com vencimento e parcelas) e mostra a recusa do servidor na
// própria folha, sem fechar.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type CategoriaFinanceira,
  type ContaFinanceira,
} from "@/types/financeiro";
import {
  escolherNaLista,
  opcoesDaLista,
  valorDaLista,
} from "./helpers/lista-de-escolha";

const HOJE = "2026-09-26";

const CONTAS: ContaFinanceira[] = [
  {
    id: CONTA_CAIXA_DA_LOJA,
    nome: "Caixa da loja",
    tipo: "caixa",
    saldoInicial: 0,
    saldoInicialEm: "2026-01-01",
    ativa: true,
    ordem: 1,
    sistema: true,
    saldo: 300,
  },
  {
    id: CONTA_BANCARIA,
    nome: "Conta bancária",
    tipo: "banco",
    saldoInicial: 0,
    saldoInicialEm: "2026-01-01",
    ativa: true,
    ordem: 2,
    sistema: true,
    saldo: 5000,
  },
];

const CATEGORIAS: CategoriaFinanceira[] = [
  {
    id: "cat-aluguel",
    nome: "Aluguel",
    natureza: "despesa",
    grupoDre: "despesa_fixa",
    ativa: true,
    sistema: false,
  },
  {
    id: "cat-sucata",
    nome: "Venda de sucata",
    natureza: "receita",
    grupoDre: "receita",
    ativa: true,
    sistema: false,
  },
];

function folha(): HTMLElement {
  const el = document.querySelector('[data-slot="sheet-content"]');
  if (!el) throw new Error("folha não abriu");
  return el as HTMLElement;
}

const texto = () => (folha().textContent ?? "").replace(/\s+/g, " ");

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...folha().querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  );
  if (!achado) throw new Error(`botão "${rotulo}" não existe`);
  return achado as HTMLButtonElement;
}

/** Digita num LocalBufferedInput e sai do campo (o blur descarrega o valor). */
async function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  const prototipo =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

/** Escolhe como a lojista: toca no campo e na opção da lista de escolha. */
async function escolher(id: string, valor: string) {
  await act(async () => {
    escolherNaLista(id, valor);
  });
}

/** As opções da lista (abre e fecha a lista dentro do `act`). */
function opcoes(id: string) {
  let lidas: ReturnType<typeof opcoesDaLista> = [];
  act(() => {
    lidas = opcoesDaLista(id);
  });
  return lidas;
}

async function mudarData(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Financeiro — Novo lançamento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let aoSalvar: Mock<(mensagem: string) => void>;
  let aoMudarSujo: Mock<(sujo: boolean) => void>;

  beforeEach(async () => {
    rpcFalso.mockReset();
    aoSalvar = vi.fn<(mensagem: string) => void>();
    aoMudarSujo = vi.fn<(sujo: boolean) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <NovoLancamentoFolha
          autorId="dona-da-loja"
          hoje={HOJE}
          contas={CONTAS}
          categorias={CATEGORIAS}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={aoMudarSujo}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("não chama o banco com campo faltando e diz o que falta", async () => {
    await clicar(botao("Salvar lançamento"));

    expect(rpcFalso).not.toHaveBeenCalled();
    expect(texto()).toContain("Informe um valor maior que zero.");
    expect(texto()).toContain("Descreva o lançamento.");
    expect(texto()).toContain("Escolha a categoria");
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it("despesa a pagar em 3× manda o corpo do contrato e fecha com a mensagem", async () => {
    rpcFalso.mockResolvedValue({ data: { ids: ["a", "b", "c"] }, error: null });

    // A categoria só lista as da natureza do tipo (despesa). O "Escolha…" é
    // o aviso do campo vazio, não uma opção que a lojista possa escolher.
    expect(opcoes("fin-lanc-categoria")).toEqual([
      { valor: "cat-aluguel", rotulo: "Aluguel", desabilitada: false },
    ]);

    await digitar("fin-lanc-valor", "123456");
    expect(
      (document.getElementById("fin-lanc-valor") as HTMLInputElement).value,
    ).toBe("1.234,56");
    expect(aoMudarSujo).toHaveBeenLastCalledWith(true);
    await digitar("fin-lanc-descricao", "Aluguel de outubro");
    await escolher("fin-lanc-categoria", "cat-aluguel");
    await clicar(botao("A pagar"));
    await mudarData("fin-lanc-vencimento", "2026-10-05");
    await escolher("fin-lanc-parcelas", "3");

    expect(texto()).toMatch(/3× de R\$ 411,52/);

    await clicar(botao("Salvar lançamento"));

    expect(rpcFalso).toHaveBeenCalledTimes(1);
    expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_salvar", {
      p: {
        chave_idempotencia: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        tipo: "saida",
        valor: 1234.56,
        conta_id: CONTA_BANCARIA,
        categoria_id: "cat-aluguel",
        descricao: "Aluguel de outubro",
        data_competencia: HOJE,
        status: "previsto",
        data_vencimento: "2026-10-05",
        parcelas: 3,
      },
    });
    expect(aoSalvar).toHaveBeenCalledWith("3 parcelas lançadas.");
  });

  it("receita já recebida vai como realizado, com a forma de pagamento", async () => {
    rpcFalso.mockResolvedValue({ data: { ids: ["x"] }, error: null });

    await clicar(botao("Receita"));
    await digitar("fin-lanc-valor", "5000");
    await digitar("fin-lanc-descricao", "Sucata de papelão");
    await escolher("fin-lanc-categoria", "cat-sucata");
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await escolher("fin-lanc-forma", "dinheiro");
    await clicar(botao("Salvar lançamento"));

    expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_salvar", {
      p: {
        chave_idempotencia: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        tipo: "entrada",
        valor: 50,
        conta_id: CONTA_CAIXA_DA_LOJA,
        categoria_id: "cat-sucata",
        descricao: "Sucata de papelão",
        forma_pagamento: "dinheiro",
        data_competencia: HOJE,
        status: "realizado",
        data_realizacao: HOJE,
      },
    });
    expect(aoSalvar).toHaveBeenCalledWith("Lançamento salvo.");
  });

  it("transferência para a mesma conta é barrada antes do banco", async () => {
    await clicar(botao("Transferência"));
    await digitar("fin-lanc-valor", "10000");
    await digitar("fin-lanc-descricao", "Depósito do caixa");
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await escolher("fin-lanc-conta-destino", CONTA_CAIXA_DA_LOJA);
    await clicar(botao("Salvar lançamento"));

    expect(rpcFalso).not.toHaveBeenCalled();
    expect(texto()).toContain("A conta de destino precisa ser outra.");
    // Transferência não tem categoria nem situação (é sempre realizada).
    expect(document.getElementById("fin-lanc-categoria")).toBeNull();
  });

  it("a recusa do servidor aparece na folha e ela não fecha", async () => {
    rpcFalso.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Conta inativa não recebe lançamento." },
    });

    await digitar("fin-lanc-valor", "990");
    await digitar("fin-lanc-descricao", "Internet");
    await escolher("fin-lanc-categoria", "cat-aluguel");
    await clicar(botao("Salvar lançamento"));

    expect(rpcFalso).toHaveBeenCalledTimes(1);
    expect(texto()).toContain("Conta inativa não recebe lançamento.");
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  // Dinheiro que mexe no Caixa da loja com data de ontem não entra na conferência
  // do caixa aberto (o servidor só liga ao caixa o que tem a data de HOJE).
  describe("aviso de data passada no Caixa da loja", () => {
    const ONTEM = "2026-09-25";
    const AVISO =
      "Este valor não entra na conferência do caixa aberto. Se o dinheiro saiu ou entrou na gaveta hoje, use a data de hoje.";

    const avisos = () =>
      [...folha().querySelectorAll('[role="status"]')].filter((el) =>
        (el.textContent ?? "").includes("conferência do caixa aberto"),
      );

    it("aparece com despesa já paga, Caixa da loja e data de ontem", async () => {
      await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
      expect(avisos()).toHaveLength(0);
      await mudarData("fin-lanc-realizacao", ONTEM);

      expect(avisos()).toHaveLength(1);
      expect(avisos().at(0)?.textContent?.replace(/\s+/g, " ").trim()).toBe(
        AVISO,
      );
    });

    it("aparece também com receita já recebida no Caixa", async () => {
      await clicar(botao("Receita"));
      await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
      await mudarData("fin-lanc-realizacao", ONTEM);

      expect(avisos()).toHaveLength(1);
    });

    it("não aparece com a data de hoje", async () => {
      await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
      await mudarData("fin-lanc-realizacao", HOJE);

      expect(avisos()).toHaveLength(0);
    });

    it("não aparece com outra conta (banco)", async () => {
      await escolher("fin-lanc-conta", CONTA_BANCARIA);
      await mudarData("fin-lanc-realizacao", ONTEM);

      expect(avisos()).toHaveLength(0);
    });

    it("não aparece com a situação 'a pagar' e some ao voltar de 'já pago'", async () => {
      await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
      await mudarData("fin-lanc-realizacao", ONTEM);
      expect(avisos()).toHaveLength(1);

      await clicar(botao("A pagar"));
      expect(avisos()).toHaveLength(0);
    });

    it("não aparece com a data apagada (campo vazio)", async () => {
      await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
      await mudarData("fin-lanc-realizacao", "");

      expect(avisos()).toHaveLength(0);
    });

    it("não trava o salvar e manda a data passada igual ao de antes", async () => {
      rpcFalso.mockResolvedValue({ data: { ids: ["x"] }, error: null });

      await digitar("fin-lanc-valor", "2500");
      await digitar("fin-lanc-descricao", "Troco do motoboy");
      await escolher("fin-lanc-categoria", "cat-aluguel");
      await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
      await mudarData("fin-lanc-realizacao", ONTEM);
      expect(avisos()).toHaveLength(1);

      const salvar = botao("Salvar lançamento");
      expect(salvar.disabled).toBe(false);
      await clicar(salvar);

      expect(rpcFalso).toHaveBeenCalledTimes(1);
      expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_salvar", {
        p: {
          chave_idempotencia: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
          tipo: "saida",
          valor: 25,
          conta_id: CONTA_CAIXA_DA_LOJA,
          categoria_id: "cat-aluguel",
          descricao: "Troco do motoboy",
          data_competencia: HOJE,
          status: "realizado",
          data_realizacao: ONTEM,
        },
      });
      expect(aoSalvar).toHaveBeenCalledWith("Lançamento salvo.");
    });
  });

  // A transferência com origem OU destino no Caixa tem a mesma regra do servidor:
  // só entra na conferência do caixa aberto se a data for a de HOJE.
  describe("aviso de transferência antiga com o Caixa da loja", () => {
    const ONTEM = "2026-09-25";
    const CHAVE = "conferência do caixa aberto";

    const avisos = () =>
      [...folha().querySelectorAll('[role="status"]')].filter((el) =>
        (el.textContent ?? "").includes(CHAVE),
      );

    async function transferir(origem: string, destino: string, data: string) {
      await clicar(botao("Transferência"));
      await escolher("fin-lanc-conta", origem);
      // "" = "Entra em" sem escolha: o campo começa assim, e "Escolha…" não é
      // opção da lista.
      if (destino) await escolher("fin-lanc-conta-destino", destino);
      await mudarData("fin-lanc-realizacao", data);
    }

    it("aparece quando o Caixa é a origem, com o texto da transferência", async () => {
      await transferir(CONTA_CAIXA_DA_LOJA, CONTA_BANCARIA, ONTEM);

      expect(avisos()).toHaveLength(1);
      expect(avisos().at(0)?.textContent?.replace(/\s+/g, " ").trim()).toBe(
        "Esta transferência com a conta Caixa não entra na conferência do caixa aberto. Se o dinheiro saiu ou entrou na gaveta hoje, use a data de hoje.",
      );
    });

    it("aparece quando o Caixa é o destino", async () => {
      await transferir(CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA, ONTEM);

      expect(avisos()).toHaveLength(1);
    });

    it("não aparece com a data de hoje", async () => {
      await transferir(CONTA_CAIXA_DA_LOJA, CONTA_BANCARIA, HOJE);

      expect(avisos()).toHaveLength(0);
    });

    it("não aparece sem o Caixa em nenhuma ponta", async () => {
      await transferir(CONTA_BANCARIA, "", ONTEM);

      expect(avisos()).toHaveLength(0);
    });

    it("não aparece com a data apagada", async () => {
      await transferir(CONTA_CAIXA_DA_LOJA, CONTA_BANCARIA, "");

      expect(avisos()).toHaveLength(0);
    });

    it("voltar para despesa troca o texto: o da transferência some", async () => {
      await transferir(CONTA_CAIXA_DA_LOJA, CONTA_BANCARIA, ONTEM);
      await clicar(botao("Despesa"));

      // Despesa no Caixa com data de ontem: aviso de despesa, nunca o da transferência.
      expect(texto()).not.toContain("Esta transferência com a conta Caixa");
      expect(avisos()).toHaveLength(1);
    });

    it("não trava o salvar e manda a data passada igual ao de antes", async () => {
      rpcFalso.mockResolvedValue({ data: { ids: ["t"] }, error: null });

      await digitar("fin-lanc-valor", "10000");
      await digitar("fin-lanc-descricao", "Depósito do caixa");
      await transferir(CONTA_CAIXA_DA_LOJA, CONTA_BANCARIA, ONTEM);
      expect(avisos()).toHaveLength(1);

      const salvar = botao("Salvar lançamento");
      expect(salvar.disabled).toBe(false);
      await clicar(salvar);

      expect(rpcFalso).toHaveBeenCalledTimes(1);
      expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_salvar", {
        p: {
          chave_idempotencia: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
          tipo: "transferencia",
          valor: 100,
          conta_id: CONTA_CAIXA_DA_LOJA,
          conta_destino_id: CONTA_BANCARIA,
          descricao: "Depósito do caixa",
          data_competencia: HOJE,
          status: "realizado",
          data_realizacao: ONTEM,
        },
      });
      expect(aoSalvar).toHaveBeenCalledWith("Lançamento salvo.");
    });
  });
});

// A lista de escolha no lugar dos `<select>` (plano da lista premium, Lote A1):
// muda só a FORMA de escolher. O que vai ao banco tem de ser o mesmo, no
// celular (folha de baixo) e no computador (lista colada no campo).
class ObservadorDeTamanhoFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe.each([
  { tela: "celular", computador: false },
  { tela: "computador", computador: true },
])(
  "Financeiro — Novo lançamento com a lista de escolha ($tela)",
  ({ computador }) => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;
    let aoSalvar: Mock<(mensagem: string) => void>;
    let aoMudarSujo: Mock<(sujo: boolean) => void>;

    beforeEach(async () => {
      rpcFalso.mockReset();
      vi.stubGlobal("ResizeObserver", ObservadorDeTamanhoFalso);
      vi.stubGlobal("matchMedia", (consulta: string) => ({
        matches: computador && consulta.includes("min-width: 1024px"),
        media: consulta,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }));
      aoSalvar = vi.fn<(mensagem: string) => void>();
      aoMudarSujo = vi.fn<(sujo: boolean) => void>();
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
      await act(async () => {
        raiz.render(
          <NovoLancamentoFolha
            autorId="dona-da-loja"
            hoje={HOJE}
            contas={CONTAS}
            categorias={CATEGORIAS}
            aoFechar={vi.fn()}
            aoSalvar={aoSalvar}
            aoMudarSujo={aoMudarSujo}
          />,
        );
      });
    });

    afterEach(() => {
      act(() => {
        raiz.unmount();
      });
      hospedeiro.remove();
      vi.unstubAllGlobals();
    });

    const campoDaLista = (id: string) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`campo ${id} não existe`);
      return el;
    };
    const corpoEnviado = () => rpcFalso.mock.calls.at(-1)?.[1]?.p;

    it("os campos de escolha são a lista nova, não o <select>", () => {
      expect(folha().querySelector("select")).toBeNull();
      for (const id of [
        "fin-lanc-categoria",
        "fin-lanc-conta",
        "fin-lanc-forma",
      ]) {
        expect(campoDaLista(id).getAttribute("aria-haspopup")).toBe("listbox");
      }
    });

    it("Categoria: começa no aviso 'Escolha…' e só lista as do tipo", async () => {
      expect(valorDaLista("fin-lanc-categoria")).toBe("");
      expect(campoDaLista("fin-lanc-categoria").textContent).toContain(
        "Escolha…",
      );
      expect(opcoes("fin-lanc-categoria").map((o) => o.valor)).toEqual([
        "cat-aluguel",
      ]);

      await clicar(botao("Receita"));
      expect(opcoes("fin-lanc-categoria").map((o) => o.valor)).toEqual([
        "cat-sucata",
      ]);
      await escolher("fin-lanc-categoria", "cat-sucata");
      expect(valorDaLista("fin-lanc-categoria")).toBe("cat-sucata");
      expect(campoDaLista("fin-lanc-categoria").textContent).toContain(
        "Venda de sucata",
      );
    });

    it("Categoria sem escolha: o erro aparece no campo e nada vai ao banco", async () => {
      await clicar(botao("Salvar lançamento"));

      const campo = campoDaLista("fin-lanc-categoria");
      expect(campo.getAttribute("aria-invalid")).toBe("true");
      expect(
        document.getElementById("fin-lanc-categoria-erro")?.textContent,
      ).toContain("Escolha a categoria");
      expect(rpcFalso).not.toHaveBeenCalled();
    });

    // Dinheiro: a transferência NUNCA pode trocar origem e destino.
    it.each([
      { origem: CONTA_CAIXA_DA_LOJA, destino: CONTA_BANCARIA },
      { origem: CONTA_BANCARIA, destino: CONTA_CAIXA_DA_LOJA },
    ])(
      "Transferência $origem -> $destino: Sai de e Entra em vão ao banco sem inverter",
      async ({ origem, destino }) => {
        rpcFalso.mockResolvedValue({ data: { ids: ["t"] }, error: null });
        await clicar(botao("Transferência"));
        await digitar("fin-lanc-valor", "10000");
        await digitar("fin-lanc-descricao", "Depósito");
        // Escolhe o destino ANTES da origem: a ordem dos toques não importa.
        await escolher("fin-lanc-conta-destino", destino);
        await escolher("fin-lanc-conta", origem);

        expect(valorDaLista("fin-lanc-conta")).toBe(origem);
        expect(valorDaLista("fin-lanc-conta-destino")).toBe(destino);
        await clicar(botao("Salvar lançamento"));

        expect(rpcFalso).toHaveBeenCalledTimes(1);
        expect(corpoEnviado()).toMatchObject({
          tipo: "transferencia",
          conta_id: origem,
          conta_destino_id: destino,
        });
      },
    );

    it("Transferência: cada lista tem o seu aria-controls e abre só a dela", async () => {
      await clicar(botao("Transferência"));
      const saiDe = campoDaLista("fin-lanc-conta");
      const entraEm = campoDaLista("fin-lanc-conta-destino");
      expect(saiDe.getAttribute("aria-controls")).toBe("fin-lanc-conta-lista");
      expect(entraEm.getAttribute("aria-controls")).toBe(
        "fin-lanc-conta-destino-lista",
      );

      await clicar(entraEm);
      expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
      expect(
        document.getElementById("fin-lanc-conta-destino-lista"),
      ).not.toBeNull();
      expect(document.getElementById("fin-lanc-conta-lista")).toBeNull();
      expect(entraEm.getAttribute("aria-expanded")).toBe("true");
      expect(saiDe.getAttribute("aria-expanded")).toBe("false");
    });

    it("Parcelas: 48 opções com busca, e 3× grava exatamente 3 parcelas", async () => {
      rpcFalso.mockResolvedValue({
        data: { ids: ["a", "b", "c"] },
        error: null,
      });
      await digitar("fin-lanc-valor", "30000");
      await digitar("fin-lanc-descricao", "Fornecedor");
      await escolher("fin-lanc-categoria", "cat-aluguel");
      await clicar(botao("A pagar"));

      const parcelas = opcoes("fin-lanc-parcelas");
      expect(parcelas).toHaveLength(48);
      expect(parcelas.at(0)).toEqual({
        valor: "1",
        rotulo: "À vista (1×)",
        desabilitada: false,
      });
      expect(parcelas.at(2)?.rotulo).toBe("3×");
      expect(parcelas.at(-1)?.valor).toBe("48");
      await clicar(campoDaLista("fin-lanc-parcelas"));
      expect(document.getElementById("fin-lanc-parcelas-busca")).not.toBeNull();
      await act(async () => {
        document
          .getElementById("fin-lanc-parcelas-lista")
          ?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
      });
      expect(document.getElementById("fin-lanc-parcelas-lista")).toBeNull();

      await escolher("fin-lanc-parcelas", "3");
      expect(texto()).toMatch(/3× de R\$ 100,00/);
      await clicar(botao("Salvar lançamento"));

      expect(rpcFalso).toHaveBeenCalledTimes(1);
      expect(corpoEnviado()).toMatchObject({ status: "previsto", parcelas: 3 });
      expect(aoSalvar).toHaveBeenCalledWith("3 parcelas lançadas.");
    });

    it("Parcelas: voltar a 'À vista' tira as parcelas do corpo; 48× é o teto", async () => {
      rpcFalso.mockResolvedValue({ data: { ids: ["a"] }, error: null });
      await digitar("fin-lanc-valor", "48000");
      await digitar("fin-lanc-descricao", "Equipamento");
      await escolher("fin-lanc-categoria", "cat-aluguel");
      await clicar(botao("A pagar"));
      await escolher("fin-lanc-parcelas", "48");
      expect(valorDaLista("fin-lanc-parcelas")).toBe("48");
      await escolher("fin-lanc-parcelas", "1");
      await clicar(botao("Salvar lançamento"));

      expect(rpcFalso).toHaveBeenCalledTimes(1);
      expect(corpoEnviado()).not.toHaveProperty("parcelas");
      expect(aoSalvar).toHaveBeenCalledWith("Lançamento salvo.");
    });

    it("Forma: 'Não informar' é opção de verdade e tira a forma do corpo", async () => {
      rpcFalso.mockResolvedValue({ data: { ids: ["x"] }, error: null });
      const formas = opcoes("fin-lanc-forma");
      expect(formas.at(0)).toEqual({
        valor: "",
        rotulo: "Não informar",
        desabilitada: false,
      });
      expect(campoDaLista("fin-lanc-forma").textContent).toContain(
        "Não informar",
      );

      await digitar("fin-lanc-valor", "5000");
      await digitar("fin-lanc-descricao", "Internet");
      await escolher("fin-lanc-categoria", "cat-aluguel");
      await escolher("fin-lanc-forma", "pix");
      expect(valorDaLista("fin-lanc-forma")).toBe("pix");
      await escolher("fin-lanc-forma", "");
      expect(valorDaLista("fin-lanc-forma")).toBe("");
      await clicar(botao("Salvar lançamento"));

      expect(rpcFalso).toHaveBeenCalledTimes(1);
      expect(corpoEnviado()).not.toHaveProperty("forma_pagamento");
    });

    it("escolher só a Categoria já deixa a folha suja (A1.5)", async () => {
      expect(aoMudarSujo).toHaveBeenLastCalledWith(false);
      await escolher("fin-lanc-categoria", "cat-aluguel");
      expect(aoMudarSujo).toHaveBeenLastCalledWith(true);
    });

    it("abrir e fechar a lista, ou escolher o que já estava, não suja a folha", async () => {
      // Abrir e fechar sem escolher.
      expect(opcoes("fin-lanc-conta").length).toBeGreaterThan(0);
      // A conta sugerida já é a bancária; escolhê-la de novo não muda nada.
      expect(valorDaLista("fin-lanc-conta")).toBe(CONTA_BANCARIA);
      await escolher("fin-lanc-conta", CONTA_BANCARIA);
      await escolher("fin-lanc-forma", "");
      expect(aoMudarSujo).toHaveBeenLastCalledWith(false);
      expect(aoMudarSujo).not.toHaveBeenCalledWith(true);
    });
  },
);
