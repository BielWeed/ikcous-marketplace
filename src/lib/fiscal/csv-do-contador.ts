// Arquivo CSV para o contador: receita por dia, devoluções/estornos, guias e pagos.
//
// Função pura (sem rede, sem React, sem relógio escondido: o "agora" do nome do arquivo
// vem de fora). Não precisa de cadastro fiscal: só lê o extrato do Financeiro e o que a
// lojista lançou na categoria de impostos. Não calcula imposto e não grava nada.
//
// Uma tabela só, com colunas FIXAS (quem já tem planilha com fórmula por posição de
// coluna não pode ver coluna andar): a primeira coluna diz de que tipo é a linha.
// Colunas novas, se um dia vierem, entram NO FIM. Mesmo padrão de `pedidos-csv.ts`:
// separador `;`, vírgula decimal, linhas CRLF e BOM no começo para o Excel acertar os acentos.
//
// Dinheiro: soma em CENTAVOS inteiros (0,10 + 0,20 tem de dar 0,30) e só vira texto no fim.

import { carimboLocalParaNomeDeArquivo } from "@/lib/data-local-csv";
import { ehDataIso, paraCentavos } from "@/lib/financeiro";
import type { LancamentoDaGuia } from "@/lib/fiscal/caderno";
import { escaparCampo } from "@/lib/pedidos-csv";
import type { LinhaDoExtrato } from "@/types/financeiro";

export type ModoDoCsv = "mensal" | "anual";

/**
 * O lançamento da guia como o caderno o lê, mais o dia em que foi paga. A consulta que
 * alimenta o arquivo precisa trazer `data_realizacao` (o caderno da tela não usa essa
 * coluna).
 */
export type LancamentoDoCsv = LancamentoDaGuia & {
  data_realizacao: string | null;
};

type LinhaDoExtratoDoCsv = Pick<
  LinhaDoExtrato,
  "origem" | "tipo" | "status" | "valor" | "data" | "descricao"
>;

export interface EntradaDoCsvDoContador {
  readonly modo: ModoDoCsv;
  /** `AAAA-MM` no modo mensal, `AAAA` no anual. */
  readonly referencia: string;
  /** O extrato do período (qualquer linha; aqui se escolhe o que conta). */
  readonly extrato: readonly LinhaDoExtratoDoCsv[];
  /** Só os lançamentos da categoria de impostos, como na entrada do caderno. */
  readonly guias: readonly LancamentoDoCsv[];
  readonly agora?: Date;
}

export interface CsvDoContador {
  readonly texto: string;
  readonly nomeDoArquivo: string;
}

const CABECALHO = "Tipo;Data;Competência;Vencimento;Valor (R$);Descrição";

const ROTULO_RECEITA = "Receita do dia";
const ROTULO_DEVOLUCAO = "Devolução ou estorno";
const ROTULO_GUIA = "Guia";
const ROTULO_PAGO = "Pago";

// As mesmas origens que o Financeiro chama de venda e de estorno (`origemVemDoPedido`).
// Lançamento manual, sangria e suprimento NÃO são receita de venda.
const ORIGENS_DE_VENDA: ReadonlySet<string> = new Set([
  "venda_online",
  "venda_balcao",
  "venda_entrega",
]);
const ORIGENS_DE_DEVOLUCAO: ReadonlySet<string> = new Set([
  "estorno",
  "estorno_externo",
  "devolucao",
]);

const REFERENCIA_MENSAL = /^(\d{4})-(0[1-9]|1[0-2])$/;
const REFERENCIA_ANUAL = /^\d{4}$/;

/** `AAAA-MM` ou `AAAA` -> primeiro e último dia (inclusivos). Referência torta é erro de quem chamou. */
function periodoDaReferencia(modo: ModoDoCsv, referencia: string) {
  if (modo === "anual") {
    if (!REFERENCIA_ANUAL.test(referencia)) {
      throw new Error(`referência anual inválida: ${referencia}`);
    }
    return { inicio: `${referencia}-01-01`, fim: `${referencia}-12-31` };
  }
  const casamento = REFERENCIA_MENSAL.exec(referencia);
  if (!casamento) throw new Error(`referência mensal inválida: ${referencia}`);
  const [, ano, mes] = casamento;
  // Dia 0 do mês seguinte = último dia deste (cobre fevereiro bissexto).
  const ultimo = new Date(Date.UTC(Number(ano), Number(mes), 0)).getUTCDate();
  return {
    inicio: `${ano}-${mes}-01`,
    fim: `${ano}-${mes}-${String(ultimo).padStart(2, "0")}`,
  };
}

/** Centavos inteiros -> "1234,50". Sem milhar, como o `pedidos-csv.ts`. */
function reais(centavos: number): string {
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const cents = String(abs % 100).padStart(2, "0");
  return `${sinal}${Math.trunc(abs / 100)},${cents}`;
}

/** `2026-10-05` -> `05/10/2026`. Só reordena o texto: dia de calendário não tem fuso. */
function dataBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** `2026-10-01` -> `10/2026`. */
function competenciaBr(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

const diaValido = (valor: unknown): valor is string =>
  typeof valor === "string" && ehDataIso(valor.slice(0, 10));

/** Ordena por texto ISO (que já é cronológico); vazio vai para o fim. A ordenação é estável. */
function porData<T>(itens: T[], chave: (item: T) => string | null): T[] {
  return itens.sort((a, b) => {
    const x = chave(a) ?? "9999-99-99";
    const y = chave(b) ?? "9999-99-99";
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function celulas(
  tipo: string,
  data: string,
  competencia: string,
  vencimento: string,
  valorEmCentavos: number,
  descricao: string,
): string {
  // O valor não passa pelo `escaparCampo`: é número que a gente formatou, e um valor
  // negativo ("-5,00") viraria texto com apóstrofo.
  return [
    escaparCampo(tipo),
    escaparCampo(data),
    escaparCampo(competencia),
    escaparCampo(vencimento),
    reais(valorEmCentavos),
    escaparCampo(descricao),
  ].join(";");
}

/**
 * Monta o CSV do período, ou devolve `null` quando não há nada a mandar: a tela não deve
 * baixar um arquivo só com cabeçalho, que pareceria "esta loja não vendeu nada".
 *
 * O que entra:
 *  - receita por dia: só venda REALIZADA (entrada, origem de venda), somada por dia;
 *  - devoluções e estornos: cada um realizado, com a descrição do extrato;
 *  - guias: as lançadas na categoria de impostos, pelo MÊS da competência (mesma regra do
 *    `montarCaderno`: só previsto e realizado, data malformada fora);
 *  - pagos: as guias já baixadas, com a data do pagamento.
 */
export function montarCsvDoContador(
  entrada: EntradaDoCsvDoContador,
): CsvDoContador | null {
  const { inicio, fim } = periodoDaReferencia(entrada.modo, entrada.referencia);
  const dentro = (dia: string) => dia >= inicio && dia <= fim;

  const receitaPorDia = new Map<string, number>();
  const devolucoes: { data: string; centavos: number; descricao: string }[] =
    [];
  for (const linha of entrada.extrato) {
    if (linha.status !== "realizado") continue;
    if (!Number.isFinite(linha.valor) || !diaValido(linha.data)) continue;
    if (!dentro(linha.data)) continue;
    const centavos = Math.abs(paraCentavos(linha.valor));
    if (linha.tipo === "entrada" && ORIGENS_DE_VENDA.has(linha.origem)) {
      receitaPorDia.set(
        linha.data,
        (receitaPorDia.get(linha.data) ?? 0) + centavos,
      );
    } else if (
      linha.tipo === "saida" &&
      ORIGENS_DE_DEVOLUCAO.has(linha.origem)
    ) {
      devolucoes.push({
        data: linha.data,
        centavos,
        descricao: linha.descricao,
      });
    }
  }

  // A guia entra pelo MÊS da competência (a competência da guia é o dia 1).
  const guias = entrada.guias.filter((l) => {
    if (l.status !== "previsto" && l.status !== "realizado") return false;
    if (!Number.isFinite(l.valor)) return false;
    const dia =
      typeof l.data_competencia === "string"
        ? l.data_competencia.slice(0, 10)
        : "";
    return ehDataIso(dia) && dentro(`${dia.slice(0, 7)}-01`);
  });

  if (
    receitaPorDia.size === 0 &&
    devolucoes.length === 0 &&
    guias.length === 0
  ) {
    return null;
  }

  const linhas: string[] = [];
  for (const dia of [...receitaPorDia.keys()].sort()) {
    linhas.push(
      celulas(
        ROTULO_RECEITA,
        dataBr(dia),
        "",
        "",
        receitaPorDia.get(dia) ?? 0,
        "",
      ),
    );
  }
  for (const d of porData(devolucoes, (x) => x.data)) {
    linhas.push(
      celulas(
        ROTULO_DEVOLUCAO,
        dataBr(d.data),
        "",
        "",
        d.centavos,
        d.descricao,
      ),
    );
  }

  const vencimentoBr = (l: LancamentoDoCsv) =>
    diaValido(l.data_vencimento) ? dataBr(l.data_vencimento.slice(0, 10)) : "";
  const guiasEmOrdem = porData(
    porData([...guias], (l) =>
      diaValido(l.data_vencimento) ? l.data_vencimento.slice(0, 10) : null,
    ),
    (l) => l.data_competencia.slice(0, 10),
  );
  for (const l of guiasEmOrdem) {
    linhas.push(
      celulas(
        ROTULO_GUIA,
        "",
        competenciaBr(l.data_competencia),
        vencimentoBr(l),
        paraCentavos(l.valor),
        "",
      ),
    );
  }

  const pagas = guias.filter((l) => l.status === "realizado");
  const diaDoPagamento = (l: LancamentoDoCsv) =>
    diaValido(l.data_realizacao) ? l.data_realizacao.slice(0, 10) : null;
  for (const l of porData([...pagas], diaDoPagamento)) {
    const dia = diaDoPagamento(l);
    linhas.push(
      celulas(
        ROTULO_PAGO,
        dia ? dataBr(dia) : "",
        competenciaBr(l.data_competencia),
        vencimentoBr(l),
        paraCentavos(l.valor),
        "",
      ),
    );
  }

  const carimbo = carimboLocalParaNomeDeArquivo(entrada.agora ?? new Date());
  return {
    texto: `\uFEFF${[CABECALHO, ...linhas].join("\r\n")}`,
    nomeDoArquivo: `impostos-${entrada.modo}-${entrada.referencia}-${carimbo}.csv`,
  };
}
