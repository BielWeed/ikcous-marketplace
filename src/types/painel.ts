/**
 * Tipos de domínio do Início do painel (`admin-dashboard`).
 *
 * As RPCs `painel_inicio()` e `assinatura_da_loja_ler()` devolvem `jsonb`
 * (em `database.types.ts` elas são `Json`) — o contrato mora em
 * `docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md`, seções
 * "CRM e Início" e "Financeiro". Quem converte o `Json` nestes tipos é o
 * parser defensivo de `src/lib/crm.ts` (`lerPainelInicio`,
 * `lerAssinaturaDaLoja`): campo ausente ou fora da forma vira `null`
 * ("não sei"), nunca zero inventado.
 */

export interface PontoDaSerieDiaria {
  /** `YYYY-MM-DD` no fuso America/Sao_Paulo. */
  readonly dia: string;
  readonly receita: number;
}

export interface PainelInicio {
  readonly hoje: {
    readonly receita: number | null;
    /** Receita do app (canal `online`). */
    readonly online: number | null;
    /** Receita do balcão (canal `presencial`). */
    readonly presencial: number | null;
    readonly pedidos: number | null;
    /** Receita do MESMO dia da semana, sete dias atrás. */
    readonly receitaSemanaPassada: number | null;
  };
  readonly mes: {
    readonly receita: number | null;
    readonly receitaMesAnterior: number | null;
    readonly pedidos: number | null;
    readonly ticketMedio: number | null;
    /** Receita − custo cadastrado dos itens (estimado: custo atual). */
    readonly lucroEstimado: number | null;
  };
  readonly saldoTotal: number | null;
  readonly aReceber7d: number | null;
  readonly aPagar7d: number | null;
  /** Quantidade de contas a pagar já vencidas. */
  readonly contasVencidas: number | null;
  readonly pendencias: {
    readonly pedidosParaPreparar: number | null;
    readonly devolucoesAbertas: number | null;
    readonly caixaAberto: boolean;
    readonly estoqueBaixo: number | null;
  };
  readonly serie14d: readonly PontoDaSerieDiaria[];
}

export type StatusDaAssinatura =
  | "ativa"
  | "teste"
  | "pendente"
  | "atrasada"
  | "suspensa"
  | "cancelada";

export interface AssinaturaDaLoja {
  readonly plano: string | null;
  /** `null` quando o banco mandou um status fora do contrato. */
  readonly status: StatusDaAssinatura | null;
  readonly valorMensal: number | null;
  readonly ciclo: string | null;
  readonly inicioEm: string | null;
  readonly proximaCobrancaEm: string | null;
  readonly testeAte: string | null;
  readonly recursos: readonly string[];
  /** Só `https://` — qualquer outro esquema é descartado no parser. */
  readonly gerenciarUrl: string | null;
  readonly suporteWhatsapp: string | null;
  readonly atualizadoEm: string | null;
}
