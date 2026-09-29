// Tipos de domínio do Financeiro do painel ("o banco da loja").
//
// O CONTRATO é a seção "Financeiro" do plano
// docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md: toda RPC
// `fin_*` devolve `jsonb`, que o supabase-js tipa como `Json`. Estes tipos são
// a forma que a tela usa DEPOIS de passar pelos parsers defensivos de
// `src/lib/financeiro.ts` — nenhum componente lê o `Json` cru.
//
// Regra de ouro (spec 2026-09-26, §2): o dinheiro mora na fonte. Venda e
// estorno são linhas DERIVADAS dos pedidos (origem venda_* / estorno*);
// só o que não tem fonte nasce em `fin_lancamentos` (origem manual,
// sangria, suprimento, ajuste_caixa).

/** Contas de sistema semeadas pela migration, com UUID fixo. */
export const CONTA_CAIXA_DA_LOJA = "f1000000-0000-4000-8000-000000000001";
export const CONTA_BANCARIA = "f1000000-0000-4000-8000-000000000002";
export const CONTA_MERCADO_PAGO = "f1000000-0000-4000-8000-000000000003";

export type TipoDeConta = "caixa" | "banco" | "mercado_pago" | "outro";

export type NaturezaDaCategoria = "receita" | "despesa";

export type GrupoDaDre =
  | "receita"
  | "deducao"
  | "custo_variavel"
  | "despesa_fixa"
  | "financeiro"
  | "fora_dre";

export type TipoDeLancamento = "entrada" | "saida" | "transferencia";

export type StatusDoLancamento = "previsto" | "realizado" | "cancelado";

export type OrigemDoLancamento =
  | "manual"
  | "sangria"
  | "suprimento"
  | "ajuste_caixa"
  | "venda_online"
  | "venda_balcao"
  | "venda_entrega"
  | "estorno"
  | "estorno_externo"
  | "devolucao";

/** Data de calendário `YYYY-MM-DD` (fuso America/Sao_Paulo). */
export type DataIso = string;

export interface IntervaloDeDatas {
  readonly inicio: DataIso;
  readonly fim: DataIso;
}

export interface SaldoDeConta {
  readonly id: string;
  readonly nome: string;
  readonly tipo: TipoDeConta;
  readonly saldo: number;
}

export interface TotaisPrevistos {
  readonly total: number;
  readonly vencido: number;
  readonly proximos7Dias: number;
}

export interface ValorPorForma {
  readonly forma: string | null;
  readonly valor: number;
}

export interface DiaDaSerie {
  readonly dia: DataIso;
  readonly entradas: number;
  readonly saidas: number;
}

export interface CaixaAbertoResumo {
  readonly id: string;
  readonly contaId: string;
  readonly abertoEm: string;
  readonly valorAbertura: number;
}

export interface ResumoFinanceiro {
  readonly periodo: IntervaloDeDatas;
  readonly saldoTotal: number;
  readonly contas: readonly SaldoDeConta[];
  readonly entradas: number;
  readonly saidas: number;
  readonly resultado: number;
  readonly aReceber: TotaisPrevistos;
  readonly aPagar: TotaisPrevistos;
  readonly porForma: readonly ValorPorForma[];
  readonly porCanal: { readonly online: number; readonly presencial: number };
  readonly serie: readonly DiaDaSerie[];
  readonly caixaAberto: CaixaAbertoResumo | null;
}

export interface LinhaDoExtrato {
  readonly id: string;
  readonly origem: OrigemDoLancamento | string;
  readonly tipo: TipoDeLancamento;
  readonly status: StatusDoLancamento;
  /** Sempre positivo — o sentido mora em `tipo`. */
  readonly valor: number;
  readonly data: DataIso;
  readonly contaId: string | null;
  readonly contaNome: string | null;
  readonly contaDestinoId: string | null;
  readonly contaDestinoNome: string | null;
  readonly categoriaId: string | null;
  readonly categoriaNome: string | null;
  readonly descricao: string;
  readonly formaPagamento: string | null;
  readonly pedidoId: string | null;
  readonly vencimento: DataIso | null;
  readonly editavel: boolean;
}

export interface LancamentoPrevisto {
  readonly id: string;
  readonly descricao: string;
  /** Sempre positivo — o sentido é o da lista (a pagar / a receber). */
  readonly valor: number;
  readonly vencimento: DataIso | null;
  readonly vencido: boolean;
  readonly contaId: string | null;
  readonly contaNome: string | null;
  readonly categoriaId: string | null;
  readonly categoriaNome: string | null;
  readonly parcela: number | null;
  readonly parcelas: number | null;
  readonly origem: OrigemDoLancamento | string;
  readonly pedidoId: string | null;
}

export interface LinhaDaDre {
  readonly grupo: GrupoDaDre | string;
  readonly categoria: string;
  readonly valor: number;
}

export interface DreFinanceira {
  readonly receitaBruta: number;
  readonly receitaOnline: number;
  readonly receitaBalcao: number;
  readonly deducoes: number;
  readonly receitaLiquida: number;
  readonly cmv: number;
  readonly cmvEstimado: boolean;
  readonly lucroBruto: number;
  readonly custosVariaveis: number;
  readonly margemContribuicao: number;
  readonly despesasFixas: number;
  readonly resultadoOperacional: number;
  readonly resultadoFinanceiro: number;
  readonly lucroLiquido: number;
  readonly linhas: readonly LinhaDaDre[];
}

export interface ContaFinanceira {
  readonly id: string;
  readonly nome: string;
  readonly tipo: TipoDeConta;
  readonly saldoInicial: number;
  readonly saldoInicialEm: DataIso | null;
  readonly ativa: boolean;
  readonly ordem: number;
  readonly sistema: boolean;
  readonly saldo: number;
}

export interface CategoriaFinanceira {
  readonly id: string;
  readonly nome: string;
  readonly natureza: NaturezaDaCategoria;
  readonly grupoDre: GrupoDaDre;
  readonly ativa: boolean;
  readonly sistema: boolean;
}

export interface MovimentoDoCaixa {
  readonly id: string;
  /** `entrada` (suprimento, venda em dinheiro) ou `saida` (sangria…). */
  readonly tipo: "entrada" | "saida";
  readonly origem: string | null;
  readonly valor: number;
  readonly descricao: string;
  /** Instante ISO (ou data) do movimento, quando o servidor manda. */
  readonly em: string | null;
}

export interface CaixaAtual {
  readonly id: string;
  readonly contaId: string;
  readonly contaNome: string;
  readonly abertoEm: string;
  readonly valorAbertura: number;
  readonly vendasDinheiro: number;
  readonly devolucoesDinheiro: number;
  readonly entradasManuais: number;
  readonly saidasManuais: number;
  readonly esperado: number;
  readonly movimentos: readonly MovimentoDoCaixa[];
}

export interface SessaoDeCaixa {
  readonly id: string;
  readonly contaNome: string;
  readonly abertoEm: string;
  readonly fechadoEm: string | null;
  readonly valorAbertura: number;
  readonly esperado: number | null;
  readonly contado: number | null;
  readonly diferenca: number | null;
  readonly status: string;
}

export interface FechamentoDeCaixa {
  readonly id: string;
  readonly esperado: number;
  readonly contado: number;
  readonly diferenca: number;
}

/** Corpo de `fin_lancamento_salvar(p jsonb)` — contrato do plano. */
export interface PayloadDoLancamento {
  readonly id?: string;
  readonly tipo: TipoDeLancamento;
  readonly valor: number;
  readonly conta_id: string;
  readonly conta_destino_id?: string;
  readonly categoria_id?: string;
  readonly descricao: string;
  readonly forma_pagamento?: string;
  readonly data_competencia: DataIso;
  readonly data_vencimento?: DataIso;
  readonly status: "previsto" | "realizado";
  readonly data_realizacao?: DataIso;
  readonly parcelas?: number;
  readonly observacao?: string;
}

/** Corpo de `fin_conta_salvar(p jsonb)`. */
export interface PayloadDaConta {
  readonly id?: string;
  readonly nome: string;
  readonly tipo: TipoDeConta;
  readonly saldo_inicial: number;
  readonly saldo_inicial_em: DataIso;
  readonly ativa: boolean;
}

/** Corpo de `fin_categoria_salvar(p jsonb)`. */
export interface PayloadDaCategoria {
  readonly id?: string;
  readonly nome: string;
  readonly natureza: NaturezaDaCategoria;
  readonly grupo_dre: GrupoDaDre;
  readonly ativa: boolean;
}

export type PresetDePeriodo =
  | "mes_atual"
  | "mes_anterior"
  | "7d"
  | "30d"
  | "ano"
  | "personalizado";

export interface PeriodoEscolhido {
  readonly preset: PresetDePeriodo;
  /** Só vale para `personalizado`. */
  readonly personalizado?: IntervaloDeDatas;
}
