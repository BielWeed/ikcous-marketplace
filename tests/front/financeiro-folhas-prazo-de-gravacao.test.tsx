// @vitest-environment jsdom
//
// Financeiro — rede pendurada: toda folha de gravação sai do "Salvando…" depois
// do prazo (30 s, o mesmo do "Novo lançamento"), diz que não deu para confirmar
// e NÃO repete a gravação sozinha. E repetir baixa/cancelamento que já tinha
// valido não vira erro: a lista é relida (aoSalvar) com a frase do servidor.
import { readFileSync } from "node:fs";
import { type ReactElement, act } from "react";
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

import {
  CategoriaFolha,
  ContaFolha,
} from "@/components/admin/financeiro/FolhasDeCadastro";
import {
  BaixarLancamentoFolha,
  CancelarLancamentoDialogo,
} from "@/components/admin/financeiro/FolhasDeLancamento";
import {
  AbrirCaixaFolha,
  FecharCaixaFolha,
  MovimentarCaixaFolha,
} from "@/components/admin/financeiro/FolhasDoCaixa";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type CaixaAtual,
  type ContaFinanceira,
} from "@/types/financeiro";

const HOJE = "2026-10-16";
const CONTAS: ContaFinanceira[] = [CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA].map(
  (id, i) => ({
    id,
    nome: id === CONTA_BANCARIA ? "Banco" : "Caixa",
    tipo: id === CONTA_BANCARIA ? ("banco" as const) : ("caixa" as const),
    saldoInicial: 0,
    saldoInicialEm: HOJE,
    ativa: true,
    ordem: i + 1,
    sistema: true,
    saldo: 100,
  }),
);
const CAIXA: CaixaAtual = {
  id: "sessao-1",
  contaId: CONTA_CAIXA_DA_LOJA,
  contaNome: "Caixa",
  abertoEm: "2026-10-16T12:00:00Z",
  valorAbertura: 100,
  vendasDinheiro: 0,
  devolucoesDinheiro: 0,
  estornosExternosDinheiro: 0,
  entradasManuais: 0,
  saidasManuais: 0,
  esperado: 100,
  movimentos: [],
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

function botao(rotulo: string): HTMLButtonElement {
  const el = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === rotulo,
  );
  if (!el) throw new Error(`Botão ${rotulo} não existe`);
  return el;
}
const temBotao = (rotulo: string) =>
  [...document.querySelectorAll("button")].some(
    (b) => b.textContent?.trim() === rotulo,
  );

async function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  const proto =
    campo instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
  });
}
async function tocar(rotulo: string) {
  await act(async () => {
    botao(rotulo).click();
  });
}
async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

interface Caso {
  readonly nome: string;
  readonly rpc: string;
  readonly montar: (a: Espioes) => ReactElement;
  readonly preencher: () => Promise<void>;
  readonly rotulo: string;
  readonly rotuloEnviando: string;
  /** Pedaço da frase de prazo que identifica a operação. */
  readonly frase: RegExp;
  /** Cadastro NOVO: depois do prazo o Salvar fica parado (poderia duplicar). */
  readonly salvarParaDepoisDoPrazo?: boolean;
  /** Cadastro: avisa a tela para reler a lista ao fechar. */
  readonly avisaSemResposta?: boolean;
}
interface Espioes {
  aoSalvar: Mock<(mensagem: string, tom?: "sucesso" | "informacao") => void>;
  aoReconciliar: Mock<(mensagem: string) => Promise<void>>;
  aoMudarEnviando: Mock<(enviando: boolean) => void>;
  aoSemResposta: Mock<() => void>;
}

const CASOS: Caso[] = [
  {
    nome: "baixa",
    rpc: "fin_lancamento_baixar",
    rotulo: "Confirmar baixa",
    rotuloEnviando: "Registrando…",
    frase: /baixa foi registrada/,
    preencher: async () => {},
    montar: (e) => (
      <BaixarLancamentoFolha
        alvo={{
          id: "lanc-1",
          descricao: "Aluguel",
          valor: 120,
          contaId: CONTA_BANCARIA,
          lado: "saida",
          vencimento: HOJE,
        }}
        hoje={HOJE}
        contas={CONTAS}
        aoMudarEnviando={e.aoMudarEnviando}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoMudarSujo={vi.fn()}
      />
    ),
  },
  {
    nome: "cancelamento",
    rpc: "fin_lancamento_cancelar",
    rotulo: "Cancelar lançamento",
    rotuloEnviando: "Cancelando…",
    frase: /cancelamento foi registrado/,
    preencher: () => digitar("fin-cancelar-motivo", "Lançado em duplicidade"),
    montar: (e) => (
      <CancelarLancamentoDialogo
        alvo={{ id: "lanc-1", descricao: "Aluguel", valor: 120 }}
        aoMudarEnviando={e.aoMudarEnviando}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoMudarSujo={vi.fn()}
      />
    ),
  },
  {
    nome: "abrir caixa",
    rpc: "fin_caixa_abrir",
    rotulo: "Abrir caixa",
    rotuloEnviando: "Abrindo…",
    frase: /caixa foi aberto/,
    preencher: () => digitar("fin-caixa-abertura", "100,00"),
    montar: (e) => (
      <AbrirCaixaFolha
        contas={CONTAS}
        aoReconciliar={e.aoReconciliar}
        aoMudarEnviando={e.aoMudarEnviando}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoMudarSujo={vi.fn()}
      />
    ),
  },
  {
    nome: "sangria",
    rpc: "fin_caixa_movimentar_com_chave",
    rotulo: "Registrar sangria",
    rotuloEnviando: "Registrando…",
    frase: /movimento foi registrado/,
    preencher: () => digitar("fin-caixa-mov-valor", "20,00"),
    montar: (e) => (
      <MovimentarCaixaFolha
        autorId="autor-1"
        aoReconciliar={e.aoReconciliar}
        aoMudarEnviando={e.aoMudarEnviando}
        sessaoId="sessao-1"
        movimento="sangria"
        esperado={100}
        contas={CONTAS}
        contaDoCaixa={CONTA_CAIXA_DA_LOJA}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoMudarSujo={vi.fn()}
      />
    ),
  },
  {
    nome: "fechar caixa",
    rpc: "fin_caixa_fechar_sessao",
    rotulo: "Fechar caixa",
    rotuloEnviando: "Fechando…",
    frase: /caixa foi fechado/,
    preencher: () => digitar("fin-caixa-contado", "100,00"),
    montar: (e) => (
      <FecharCaixaFolha
        aoReconciliar={e.aoReconciliar}
        aoMudarEnviando={e.aoMudarEnviando}
        caixa={CAIXA}
        aoFechar={vi.fn()}
        aoFechado={() => e.aoSalvar("Caixa fechado.")}
        aoMudarSujo={vi.fn()}
      />
    ),
  },
  {
    nome: "nova conta",
    rpc: "fin_conta_salvar",
    rotulo: "Salvar",
    rotuloEnviando: "Salvando…",
    frase: /conta foi salva/,
    salvarParaDepoisDoPrazo: true,
    avisaSemResposta: true,
    preencher: () => digitar("fin-conta-nome", "Banco da loja"),
    montar: (e) => (
      <ContaFolha
        conta={null}
        hoje={HOJE}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoSemResposta={e.aoSemResposta}
        aoMudarSujo={vi.fn()}
      />
    ),
  },
  {
    // Edição tem id: o servidor atualiza a mesma linha, repetir não duplica.
    nome: "conta existente",
    rpc: "fin_conta_salvar",
    rotulo: "Salvar",
    rotuloEnviando: "Salvando…",
    frase: /conta foi salva/,
    avisaSemResposta: true,
    preencher: async () => {},
    montar: (e) => (
      <ContaFolha
        conta={CONTAS[0]}
        hoje={HOJE}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoSemResposta={e.aoSemResposta}
        aoMudarSujo={vi.fn()}
      />
    ),
  },
  {
    nome: "nova categoria",
    rpc: "fin_categoria_salvar",
    rotulo: "Salvar",
    rotuloEnviando: "Salvando…",
    frase: /categoria foi salva/,
    salvarParaDepoisDoPrazo: true,
    avisaSemResposta: true,
    preencher: () => digitar("fin-categoria-nome", "Aluguel da loja"),
    montar: (e) => (
      <CategoriaFolha
        categoria={null}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoSemResposta={e.aoSemResposta}
        aoMudarSujo={vi.fn()}
      />
    ),
  },
];

function espioes(): Espioes {
  return {
    aoSalvar:
      vi.fn<(mensagem: string, tom?: "sucesso" | "informacao") => void>(),
    aoReconciliar: vi.fn<(mensagem: string) => Promise<void>>(async () => {}),
    aoMudarEnviando: vi.fn<(enviando: boolean) => void>(),
    aoSemResposta: vi.fn<() => void>(),
  };
}
const chamadasDa = (rpc: string) =>
  rpcFalso.mock.calls.filter(([nome]) => nome === rpc);

beforeEach(() => {
  vi.useFakeTimers();
  rpcFalso.mockReset();
  localStorage.clear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe.each(CASOS)("rede pendurada — $nome", (caso) => {
  it("sai do 'Salvando…' no prazo, explica e não grava de novo sozinha", async () => {
    rpcFalso.mockImplementation(() => new Promise(() => {}));
    const e = espioes();
    await act(async () => raiz.render(caso.montar(e)));
    await caso.preencher();

    await tocar(caso.rotulo);
    // Gravação no ar: botão trocado e travado, uma chamada só.
    expect(temBotao(caso.rotuloEnviando)).toBe(true);
    expect(botao(caso.rotuloEnviando).disabled).toBe(true);
    expect(chamadasDa(caso.rpc)).toHaveLength(1);

    await passar(29_000);
    expect(temBotao(caso.rotuloEnviando)).toBe(true);

    await passar(2_000);
    // Saiu do "Salvando…": botão de volta, destravado, com a explicação.
    expect(temBotao(caso.rotuloEnviando)).toBe(false);
    // Cadastro novo: o Salvar fica parado (poderia criar outro igual).
    expect(botao(caso.rotulo).disabled).toBe(!!caso.salvarParaDepoisDoPrazo);
    const texto = document.body.textContent ?? "";
    expect(texto).toMatch(/demorou demais/);
    expect(texto).toMatch(caso.frase);
    expect(texto).toMatch(/confira/i);
    expect(texto).not.toMatch(/Não consegui falar com o servidor/);
    // A folha deixa de avisar "enviando" (a janela volta a poder fechar).
    if (!caso.avisaSemResposta) {
      expect(e.aoMudarEnviando).toHaveBeenLastCalledWith(false);
    }

    // Nada foi dado como salvo e nada foi regravado, nem muito tempo depois.
    await passar(120_000);
    expect(chamadasDa(caso.rpc)).toHaveLength(1);
    expect(e.aoSalvar).not.toHaveBeenCalled();
    expect(e.aoReconciliar).not.toHaveBeenCalled();

    if (caso.avisaSemResposta) expect(e.aoSemResposta).toHaveBeenCalledTimes(1);
    if (caso.salvarParaDepoisDoPrazo) {
      // Nem um toque novo grava: só fechar e conferir a lista relida.
      await tocar(caso.rotulo);
      expect(chamadasDa(caso.rpc)).toHaveLength(1);
      return;
    }
    // Repetir é ação da pessoa: um toque, uma nova chamada, com os MESMOS dados
    // (e, na sangria, a mesma chave de repetição).
    await tocar(caso.rotulo);
    expect(chamadasDa(caso.rpc)).toHaveLength(2);
    const [primeira, segunda] = chamadasDa(caso.rpc);
    expect(segunda[1]).toEqual(primeira[1]);
    if (caso.nome === "sangria") {
      expect(primeira[1].p_chave).toMatch(/^[0-9a-f-]{36}$/i);
      expect(segunda[1].p_chave).toBe(primeira[1].p_chave);
    }
  });
});

describe("repetir depois de resposta perdida", () => {
  const jaBaixado = {
    code: "22023",
    message: "Este lançamento já foi baixado ou cancelado.",
    details: null,
  };
  const jaCancelado = {
    code: "22023",
    message: "Este lançamento já está cancelado.",
    details: null,
  };

  it("baixa já feita: relê a lista (aoSalvar informativo) em vez de ficar no erro", async () => {
    rpcFalso.mockResolvedValue({ data: null, error: jaBaixado });
    const e = espioes();
    await act(async () => raiz.render(CASOS[0].montar(e)));
    await tocar("Confirmar baixa");
    expect(e.aoSalvar).toHaveBeenCalledTimes(1);
    const [mensagem, tom] = e.aoSalvar.mock.calls[0];
    expect(mensagem).toMatch(/já foi baixado ou cancelado/);
    expect(mensagem).toMatch(/Atualizei a lista/);
    expect(tom).toBe("informacao");
    expect(chamadasDa("fin_lancamento_baixar")).toHaveLength(1);
  });

  it("cancelamento já feito: relê a lista também", async () => {
    rpcFalso.mockResolvedValue({ data: null, error: jaCancelado });
    const e = espioes();
    await act(async () => raiz.render(CASOS[1].montar(e)));
    await CASOS[1].preencher();
    await tocar("Cancelar lançamento");
    expect(e.aoSalvar).toHaveBeenCalledTimes(1);
    expect(e.aoSalvar.mock.calls[0][0]).toMatch(/já está cancelado/);
    expect(e.aoSalvar.mock.calls[0][1]).toBe("informacao");
  });

  it("outra recusa 22023 (data no futuro) continua erro na folha, sem reler", async () => {
    rpcFalso.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "A baixa não pode ter data no futuro.",
        details: null,
      },
    });
    const e = espioes();
    await act(async () => raiz.render(CASOS[0].montar(e)));
    await tocar("Confirmar baixa");
    expect(e.aoSalvar).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/data no futuro/);
  });

  it("falha sem código (rede) continua erro na folha, sem reler", async () => {
    rpcFalso.mockResolvedValue({
      data: null,
      error: { message: "Failed to fetch" },
    });
    const e = espioes();
    await act(async () => raiz.render(CASOS[0].montar(e)));
    await tocar("Confirmar baixa");
    expect(e.aoSalvar).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/Não consegui falar/);
  });

  it("as duas frases que a tela reconhece existem na RPC vigente", () => {
    const sql = readFileSync(
      "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
      "utf8",
    );
    expect(sql).toContain("Este lançamento já foi baixado ou cancelado.");
    expect(sql).toContain("Este lançamento já está cancelado.");
  });
});
