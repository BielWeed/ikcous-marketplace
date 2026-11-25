// Cadastro fiscal da loja: leitura defensiva da linha do banco, validação do
// formulário e a pergunta "esta loja tem conta (estimativa/medidor)?".
//
// Lógica pura: nada aqui toca rede, React nem o relógio. "Hoje" entra por
// parâmetro (data de São Paulo, `hojeEmSaoPaulo`), como no resto do Financeiro.
//
// A REGRA QUE MANDA: o app NÃO supõe regime nenhum. Loja sem cadastro (ou com
// cadastro que não dá para entender) é "sem cadastro" — nunca um regime padrão.
// Cada loja tem o regime e a atividade que o banco DELA guarda; nenhum nome,
// id ou número de loja mora no código.

import { ehDataIso } from "@/lib/financeiro";
import type { Database } from "@/types/database.types";
import type { DataIso } from "@/types/financeiro";

export type RegimeFiscal = "mei" | "simples" | "presumido" | "real" | "nao_sei";
export type AtividadeFiscal = "comercio" | "com_servico";

export const REGIMES_FISCAIS: readonly RegimeFiscal[] = [
  "mei",
  "simples",
  "presumido",
  "real",
  "nao_sei",
];
export const ATIVIDADES_FISCAIS: readonly AtividadeFiscal[] = [
  "comercio",
  "com_servico",
];

// A linha de `fiscal_cadastro` é a do banco (src/types/database.types.ts), não
// uma cópia: a nulidade e os nomes das colunas vêm da migration. `id` é a trava
// de "uma linha só" (boolean sempre true); `vende_no_app_desde` é sempre dia 1
// (CHECK no banco). `regime` e `atividade` são `text` com CHECK no banco, então
// aqui chegam como `string`: quem estreita para `RegimeFiscal`/`AtividadeFiscal`
// é `parseCadastroFiscal`, que recusa o que o app não conhece.
export type LinhaDoCadastroFiscal =
  Database["public"]["Tables"]["fiscal_cadastro"]["Row"];

/** O cadastro com os nomes do app (mesmo padrão dos `parse*` do Financeiro). */
export interface CadastroFiscal {
  regime: RegimeFiscal;
  atividade: AtividadeFiscal;
  abertaEm: DataIso | null;
  vendeNoAppDesde: DataIso | null;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

export type LeituraDoCadastroFiscal =
  | { estado: "sem_cadastro"; aviso?: string }
  | { estado: "com_cadastro"; cadastro: CadastroFiscal };

/**
 * Aviso de quando existe uma linha, mas ela não diz um regime/atividade que o
 * app conheça (versão antiga lendo valor novo, banco mexido à mão). A tela
 * trata como "sem cadastro" e mostra isto: chutar um regime aqui mostraria
 * número de imposto errado a quem não pediu.
 */
export const AVISO_DO_CADASTRO_ILEGIVEL =
  "Não deu para entender o cadastro fiscal guardado. Configure o regime da sua empresa de novo.";

function ehRegime(valor: unknown): valor is RegimeFiscal {
  return REGIMES_FISCAIS.some((regime) => regime === valor);
}

function ehAtividade(valor: unknown): valor is AtividadeFiscal {
  return ATIVIDADES_FISCAIS.some((atividade) => atividade === valor);
}

function comoObjeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

/** Data opcional: o que não é uma data de calendário vira `null`, sem derrubar o cadastro. */
function dataOuNulo(valor: unknown): DataIso | null {
  return ehDataIso(valor) ? valor : null;
}

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

/**
 * Lê o que veio de `fiscal_cadastro` (linha única, lista com uma linha ou
 * nada). Ausência é "sem cadastro" SEM aviso: é o estado normal de toda loja
 * até a lojista configurar. Linha ilegível é "sem cadastro" COM aviso.
 */
export function parseCadastroFiscal(linha: unknown): LeituraDoCadastroFiscal {
  const bruto = Array.isArray(linha) ? linha[0] : linha;
  if (bruto === null || bruto === undefined) return { estado: "sem_cadastro" };

  const o = comoObjeto(bruto);
  if (!o || !ehRegime(o.regime) || !ehAtividade(o.atividade)) {
    return { estado: "sem_cadastro", aviso: AVISO_DO_CADASTRO_ILEGIVEL };
  }
  return {
    estado: "com_cadastro",
    cadastro: {
      regime: o.regime,
      atividade: o.atividade,
      abertaEm: dataOuNulo(o.aberta_em),
      vendeNoAppDesde: dataOuNulo(o.vende_no_app_desde),
      atualizadoEm: textoOuNulo(o.atualizado_em),
      atualizadoPor: textoOuNulo(o.atualizado_por),
    },
  };
}

// Os campos chegam como texto do formulário (select e campo de data): quem
// valida é esta função, não o tipo.
export interface FormularioDoCadastroFiscal {
  regime: string;
  atividade: string;
  /** `""` = não informado. */
  abertaEm: string;
  /** `""` = não informado. Tem de ser o dia 1 do mês. */
  vendeNoAppDesde: string;
}

export type CampoDoCadastroFiscal = keyof FormularioDoCadastroFiscal;

export type ErrosDoCadastroFiscal = Partial<
  Record<CampoDoCadastroFiscal, string>
>;

/** O corpo de `fiscal_cadastro_salvar(p jsonb)`: datas ISO, opcionais como null. */
export interface PayloadDoCadastroFiscal {
  regime: RegimeFiscal;
  atividade: AtividadeFiscal;
  aberta_em: DataIso | null;
  vende_no_app_desde: DataIso | null;
}

export type ResultadoDoCadastroFiscal =
  | { ok: true; payload: PayloadDoCadastroFiscal }
  | { ok: false; erros: ErrosDoCadastroFiscal };

/**
 * Valida o formulário e monta o corpo de `fiscal_cadastro_salvar`. Recusa
 * antes de ir ao banco o que o banco recusaria (regime/atividade fora da
 * lista, mês que não é dia 1) e o que ele deixaria passar mas não faz sentido
 * (empresa aberta no futuro). Com qualquer erro NÃO há payload.
 */
export function montarPayloadDoCadastro(
  form: FormularioDoCadastroFiscal,
  hoje: DataIso,
): ResultadoDoCadastroFiscal {
  const erros: ErrosDoCadastroFiscal = {};

  const regime = form.regime.trim();
  if (!ehRegime(regime)) erros.regime = "Escolha o regime da sua empresa.";

  const atividade = form.atividade.trim();
  if (!ehAtividade(atividade)) {
    erros.atividade = "Diga se a sua empresa vende só produtos ou tem serviço.";
  }

  let abertaEm: DataIso | null = null;
  const abertaTexto = form.abertaEm.trim();
  if (abertaTexto !== "") {
    if (!ehDataIso(abertaTexto)) {
      erros.abertaEm = "Informe a data de abertura completa (dia/mês/ano).";
    } else if (abertaTexto > hoje) {
      erros.abertaEm = "A data de abertura não pode ser no futuro.";
    } else {
      abertaEm = abertaTexto;
    }
  }

  let vendeNoAppDesde: DataIso | null = null;
  const vendeTexto = form.vendeNoAppDesde.trim();
  if (vendeTexto !== "") {
    if (!ehDataIso(vendeTexto)) {
      erros.vendeNoAppDesde = "Informe o mês em que começou a vender.";
    } else if (!vendeTexto.endsWith("-01")) {
      // O banco só guarda o dia 1 (o que vale é o mês).
      erros.vendeNoAppDesde = "Escolha só o mês: a data guardada é o dia 1.";
    } else {
      vendeNoAppDesde = vendeTexto;
    }
  }

  if (
    Object.keys(erros).length > 0 ||
    !ehRegime(regime) ||
    !ehAtividade(atividade)
  ) {
    return { ok: false, erros };
  }
  return {
    ok: true,
    payload: {
      regime,
      atividade,
      aberta_em: abertaEm,
      vende_no_app_desde: vendeNoAppDesde,
    },
  };
}

/** Por que uma loja não tem conta. Estável: a tela e o teste leem o motivo, não o texto. */
export type MotivoSemConta =
  | "simples_com_servico"
  | "presumido"
  | "real"
  | "nao_sei";

export type QuemTemConta =
  | { tipo: "mei" }
  | { tipo: "simples_comercio" }
  | { tipo: "nenhuma"; motivo: MotivoSemConta };

/**
 * Só MEI e Simples de só comércio têm conta (medidor / estimativa). Tudo o
 * mais fica sem conta, com o motivo: caderno e arquivo para o contador
 * funcionam do mesmo jeito. A atividade só pesa no Simples; para os demais
 * regimes ela não muda a resposta.
 */
export function quemTemConta(
  cadastro: Pick<CadastroFiscal, "regime" | "atividade">,
): QuemTemConta {
  switch (cadastro.regime) {
    case "mei":
      return { tipo: "mei" };
    case "simples":
      return cadastro.atividade === "comercio"
        ? { tipo: "simples_comercio" }
        : { tipo: "nenhuma", motivo: "simples_com_servico" };
    case "presumido":
      return { tipo: "nenhuma", motivo: "presumido" };
    case "real":
      return { tipo: "nenhuma", motivo: "real" };
    case "nao_sei":
      return { tipo: "nenhuma", motivo: "nao_sei" };
  }
}
