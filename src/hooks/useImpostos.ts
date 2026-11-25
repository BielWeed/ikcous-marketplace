// Leitura e escrita da aba Impostos (Gestão Fiscal).
//
// As LEITURAS usam a mesma consulta com prazo de 20 s do Financeiro
// (`useConsultaFinanceira`): `chave === null` não busca nada, resposta velha não
// sobrescreve a nova, o cache da tela guarda a última resposta e a `versao` que a
// view sobe depois de uma escrita faz tudo ler de novo. Todas só LEEM: nada aqui
// grava lançamento financeiro, e a estimativa de imposto não passa por este arquivo.
//
// A REGRA DA SÉRIE DO RESULTADO: o `fin_dre` (um por mês, o mesmo do Resultado)
// só é lido para quem TEM conta (MEI e Simples de só comércio). Loja sem cadastro,
// com cadastro ilegível, com a leitura do cadastro falha ou com regime sem conta
// não paga ~15 leituras por uma série que a tela não vai usar. `quemTemConta` é
// quem decide; nenhum regime é suposto aqui.
//
// A ESCRITA do cadastro (`salvarCadastroFiscal`) chama o RPC que só o dono da loja
// pode chamar (o banco confere). Ela NUNCA repete sozinha: rede sem resposta
// encerra a espera da tela, mas o servidor pode ter gravado, e a frase manda
// conferir antes de repetir.

import {
  type ConsultaFinanceira,
  lerDre,
  useConsultaFinanceira,
} from "@/hooks/useFinanceiro";
import {
  ErroDePrazoFinanceiro,
  ehFalhaDeRedeSemCodigo,
  fraseDeGravacaoSemConfirmacao,
  mensagemDeErroFinanceiro,
} from "@/lib/financeiro";
import {
  type LeituraDoCadastroFiscal,
  type PayloadDoCadastroFiscal,
  parseCadastroFiscal,
  quemTemConta,
} from "@/lib/fiscal/cadastro";
import type { LancamentoDaGuia } from "@/lib/fiscal/caderno";
import { CATEGORIA_DE_IMPOSTOS_ID } from "@/lib/fiscal/receita-do-mes";
import { FRASE_SO_O_DONO_ALTERA } from "@/lib/fiscal/textos";
import { aguardarComPrazo } from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import type { Database, Json } from "@/types/database.types";
import type { DreFinanceira, IntervaloDeDatas } from "@/types/financeiro";

// ---------------------------------------------------------------------------
// Frases de erro
// ---------------------------------------------------------------------------

/** Erro de leitura já em português. Estende o erro de prazo do Financeiro só para a
 * consulta mostrar a frase PRONTA (`mensagemDeErroFinanceiro` devolve `message`). */
class ErroDeLeituraFiscal extends ErroDePrazoFinanceiro {}

function codigoDe(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null) return null;
  const { code } = erro as { code?: unknown };
  return typeof code === "string" && code !== "" ? code : null;
}

function mensagemDe(erro: unknown): string {
  if (typeof erro !== "object" || erro === null) return "";
  const { message } = erro as { message?: unknown };
  return typeof message === "string" ? message : "";
}

// Tabela que não existe neste banco (migration ainda não aplicada), vista pelo
// PostgREST (PGRST205) ou pelo Postgres (42P01).
function tabelaAusente(erro: unknown): boolean {
  const codigo = codigoDe(erro);
  return codigo === "PGRST205" || codigo === "42P01";
}

const FRASE_CADASTRO_NAO_INSTALADO =
  "O cadastro fiscal ainda não foi instalado no banco desta loja. Fale com o suporte do IKCOUS.";
const FRASE_FINANCEIRO_NAO_INSTALADO =
  "O Financeiro ainda não foi instalado no banco desta loja.";

/** Falha de leitura de uma tabela: frase pronta, nunca o texto cru do banco. */
function falhaDeLeitura(erro: unknown, aTabela: "fiscal" | "financeiro") {
  if (tabelaAusente(erro)) {
    return new ErroDeLeituraFiscal(
      aTabela === "fiscal"
        ? FRASE_CADASTRO_NAO_INSTALADO
        : FRASE_FINANCEIRO_NAO_INSTALADO,
    );
  }
  return new ErroDeLeituraFiscal(mensagemDeErroFinanceiro(erro));
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

/**
 * O cadastro fiscal da loja. Banco sem linha = "sem cadastro" (estado normal de
 * toda loja até a lojista configurar); linha que o app não entende = "sem
 * cadastro" COM aviso. Nunca um regime padrão.
 */
export function useCadastroFiscal(
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<LeituraDoCadastroFiscal> {
  return useConsultaFinanceira(
    ativo ? "fiscal-cadastro" : null,
    async () => {
      const { data, error } = await supabase
        .from("fiscal_cadastro")
        .select(
          "regime, atividade, aberta_em, vende_no_app_desde, atualizado_em, atualizado_por",
        )
        .maybeSingle();
      if (error) throw falhaDeLeitura(error, "fiscal");
      return parseCadastroFiscal(data);
    },
    versao,
  );
}

/** Uma alteração do cadastro: quando, quem, e o antes/depois como o banco guardou. */
export type LinhaDoLogFiscal = Pick<
  Database["public"]["Tables"]["fiscal_cadastro_log"]["Row"],
  "id" | "quem" | "quando" | "antes" | "depois"
>;

/** O número de alterações que a tela mostra. */
export const ALTERACOES_MOSTRADAS = 5;

/** As últimas alterações do cadastro, da mais nova para a mais antiga. */
export function useLogDoCadastroFiscal(
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<LinhaDoLogFiscal[]> {
  return useConsultaFinanceira(
    ativo ? "fiscal-cadastro-log" : null,
    async () => {
      const { data, error } = await supabase
        .from("fiscal_cadastro_log")
        .select("id, quem, quando, antes, depois")
        // O `id` desempata duas alterações no mesmo instante.
        .order("quando", { ascending: false })
        .order("id", { ascending: false })
        .limit(ALTERACOES_MOSTRADAS);
      if (error) throw falhaDeLeitura(error, "fiscal");
      return Array.isArray(data) ? data : [];
    },
    versao,
  );
}

/**
 * Uma guia lançada: as colunas do caderno MAIS `data_realizacao`, que dá a data do
 * "pago" no arquivo do contador.
 */
export type GuiaLida = LancamentoDaGuia &
  Pick<
    Database["public"]["Tables"]["fin_lancamentos"]["Row"],
    "data_realizacao"
  >;

/**
 * As guias lançadas na categoria de impostos: sem as canceladas, pela COMPETÊNCIA.
 * A competência da guia é o dia 1 do mês das vendas, então o limite de baixo é o
 * dia 1 do mês em que o período começa (como o caderno): um período que começa no
 * dia 15 ainda conta a guia desse mês.
 */
export function useGuiasDeImpostos(
  periodo: IntervaloDeDatas | null,
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<GuiaLida[]> {
  return useConsultaFinanceira(
    ativo && periodo ? `fiscal-guias:${periodo.inicio}:${periodo.fim}` : null,
    async () => {
      if (!periodo) throw new Error("sem período");
      const { data, error } = await supabase
        .from("fin_lancamentos")
        .select(
          "valor, status, data_competencia, data_vencimento, data_realizacao",
        )
        .eq("categoria_id", CATEGORIA_DE_IMPOSTOS_ID)
        .neq("status", "cancelado")
        .gte("data_competencia", `${periodo.inicio.slice(0, 7)}-01`)
        .lte("data_competencia", periodo.fim)
        .order("data_competencia", { ascending: true });
      if (error) throw falhaDeLeitura(error, "financeiro");
      return Array.isArray(data) ? data : [];
    },
    versao,
  );
}

/** A loja tem conta (medidor do MEI ou estimativa do Simples)? Só então a série é lida. */
function temConta(cadastro: LeituraDoCadastroFiscal | null): boolean {
  return (
    cadastro?.estado === "com_cadastro" &&
    quemTemConta(cadastro.cadastro).tipo !== "nenhuma"
  );
}

/**
 * Uma DRE por mês (`fin_dre`, a MESMA do Resultado), na ordem dos meses. SÓ para
 * quem tem conta: com `cadastro` ausente (ainda lendo ou leitura falha), sem
 * cadastro ou com regime sem conta, não lê nada. Com UM mês também lê (o medidor do
 * MEI começa em janeiro), diferente de `useDreMensal`, que pede dois ou mais.
 */
export function useSerieDaReceita(
  meses: readonly IntervaloDeDatas[],
  cadastro: LeituraDoCadastroFiscal | null,
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<DreFinanceira[]> {
  const primeiro = meses.at(0);
  const ultimo = meses.at(-1);
  return useConsultaFinanceira(
    ativo && primeiro && ultimo && temConta(cadastro)
      ? `fiscal-dre:${primeiro.inicio}:${ultimo.fim}`
      : null,
    () => Promise.all(meses.map((mes) => lerDre(mes))),
    versao,
  );
}

// ---------------------------------------------------------------------------
// Escrita do cadastro
// ---------------------------------------------------------------------------

/** O prazo da gravação: o mesmo das escritas do Financeiro. */
const PRAZO_DE_SALVAR_O_CADASTRO_MS = 30_000;

/**
 * Falha ao salvar o cadastro, com a frase pronta. `semResposta`: não dá para
 * saber se o servidor gravou (prazo estourado ou queda de rede) — a tela deve
 * mandar conferir e NÃO repetir sozinha. `false`: o servidor recusou.
 */
export class ErroDoCadastroFiscal extends Error {
  readonly semResposta: boolean;
  constructor(mensagem: string, semResposta: boolean) {
    super(mensagem);
    this.name = "ErroDoCadastroFiscal";
    this.semResposta = semResposta;
  }
}

const FEITO = "o cadastro fiscal foi salvo";
const ONDE = "o cadastro fiscal";

function falhaAoSalvar(erro: unknown): ErroDoCadastroFiscal {
  if (erro instanceof ErroDoCadastroFiscal) return erro;
  const codigo = codigoDe(erro);
  // Quem barra é o banco (dono da loja + admin atual): ele responde 42501.
  if (codigo === "42501") {
    return new ErroDoCadastroFiscal(FRASE_SO_O_DONO_ALTERA, false);
  }
  if (
    codigo === "PGRST202" ||
    codigo === "42883" ||
    tabelaAusente(erro) ||
    mensagemDe(erro).includes("Could not find the function")
  ) {
    return new ErroDoCadastroFiscal(FRASE_CADASTRO_NAO_INSTALADO, false);
  }
  // Queda de rede sem resposta do banco: pode ter gravado.
  if (ehFalhaDeRedeSemCodigo(erro)) {
    return new ErroDoCadastroFiscal(
      fraseDeGravacaoSemConfirmacao(FEITO, ONDE),
      true,
    );
  }
  return new ErroDoCadastroFiscal(mensagemDeErroFinanceiro(erro), false);
}

/**
 * Grava o cadastro fiscal pelo RPC `fiscal_cadastro_salvar`. Recebe o payload JÁ
 * validado por `montarPayloadDoCadastro` (a tela não chega aqui com erro de
 * formulário) e manda exatamente os quatro campos dele, nada além.
 *
 * Devolve o cadastro como o banco respondeu. Falha lança `ErroDoCadastroFiscal`
 * com a frase pronta. É UMA chamada: nunca repete por conta própria, nem no prazo
 * estourado nem na queda de rede; a resposta tardia é descartada.
 */
export async function salvarCadastroFiscal(
  payload: PayloadDoCadastroFiscal,
): Promise<LeituraDoCadastroFiscal> {
  const p: Json = {
    regime: payload.regime,
    atividade: payload.atividade,
    aberta_em: payload.aberta_em,
    vende_no_app_desde: payload.vende_no_app_desde,
  };
  try {
    const { data, error } = await aguardarComPrazo(
      Promise.resolve(supabase.rpc("fiscal_cadastro_salvar", { p })),
      PRAZO_DE_SALVAR_O_CADASTRO_MS,
      () =>
        new ErroDoCadastroFiscal(
          `A internet demorou demais e não deu para confirmar se ${FEITO}. Feche esta tela e confira ${ONDE} antes de repetir.`,
          true,
        ),
    );
    if (error) throw error;
    // O banco gravou. Resposta que o app não entende vira "sem cadastro" (com
    // aviso), não erro: a tela relê o cadastro depois, e dizer "falhou" aqui faria
    // a lojista repetir uma gravação que deu certo.
    return parseCadastroFiscal(data);
  } catch (erro) {
    throw falhaAoSalvar(erro);
  }
}
