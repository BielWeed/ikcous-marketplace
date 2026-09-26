/**
 * Tipos de domínio do Dashboard CRM (`admin-crm`).
 *
 * `crm_visao(p_inicio, p_fim)` e `crm_clientes(...)` devolvem `jsonb` — o
 * contrato está em `docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md`
 * ("CRM e Início"). O parser defensivo é `lerVisaoDoCrm`/`lerClientesDoCrm`
 * em `src/lib/crm.ts`.
 */

export type SegmentoCrm =
  | "campeoes"
  | "leais"
  | "ativos"
  | "novos"
  | "promissores"
  | "precisam_atencao"
  | "quase_dormindo"
  | "em_risco"
  | "nao_pode_perder"
  | "hibernando";

/** Chips de período do CRM — cada um vira um intervalo de datas. */
export type PeriodoDoCrm = "hoje" | "7d" | "30d" | "90d" | "mes" | "ano";

export interface IntervaloDeDatas {
  /** `YYYY-MM-DD` no fuso America/Sao_Paulo. */
  readonly inicio: string;
  readonly fim: string;
}

export interface KpisDoCrm {
  readonly receita: number | null;
  readonly receitaAnterior: number | null;
  readonly pedidos: number | null;
  readonly pedidosAnterior: number | null;
  readonly ticketMedio: number | null;
  readonly ticketMedioAnterior: number | null;
  readonly clientesCompradores: number | null;
  readonly clientesNovos: number | null;
  /** Percentual (0–100) de compradores do período com 2+ pedidos na vida. */
  readonly taxaRecompra: number | null;
  /** Percentual (0–100) da receita vinda de clientes recorrentes. */
  readonly receitaRecorrentePct: number | null;
  readonly ltvMedio: number | null;
  /** Receita histórica dos clientes nos segmentos de risco. */
  readonly receitaEmRisco: number | null;
  /** Percentual (0–100) de pedidos do período com devolução. */
  readonly taxaDevolucao: number | null;
}

export interface CanalDoCrm {
  /** `online` (app) ou `presencial` (balcão); outro valor passa cru. */
  readonly canal: string;
  readonly receita: number;
  readonly pedidos: number;
  readonly ticketMedio: number;
}

export interface FormaDePagamentoDoCrm {
  readonly forma: string;
  readonly receita: number;
  readonly pedidos: number;
}

export interface FunilDoCrm {
  readonly visitas: number | null;
  readonly produtosVistos: number | null;
  readonly carrinhos: number | null;
  readonly pedidosCriados: number | null;
  readonly pedidosPagos: number | null;
}

export interface EtapaDoPipeline {
  readonly status: string;
  readonly quantidade: number;
  /** Instante ISO do pedido mais antigo parado neste status. */
  readonly maisAntigoEm: string | null;
}

export interface ResumoDoSegmento {
  readonly segmento: SegmentoCrm;
  readonly clientes: number;
  readonly receita: number;
}

export interface VisaoDoCrm {
  readonly kpis: KpisDoCrm;
  readonly canais: readonly CanalDoCrm[];
  readonly formas: readonly FormaDePagamentoDoCrm[];
  readonly funil: FunilDoCrm;
  readonly pipeline: readonly EtapaDoPipeline[];
  readonly segmentos: readonly ResumoDoSegmento[];
}

export interface ClienteDoCrm {
  /** Identidade estável: `user_id` da conta ou o WhatsApp do balcão. */
  readonly chave: string;
  readonly userId: string | null;
  readonly nome: string | null;
  readonly whatsapp: string | null;
  readonly email: string | null;
  readonly pedidos: number;
  readonly receita: number;
  readonly ticketMedio: number | null;
  readonly primeiraCompra: string | null;
  readonly ultimaCompra: string | null;
  readonly diasSemComprar: number | null;
  readonly r: number | null;
  readonly f: number | null;
  readonly m: number | null;
  readonly segmento: SegmentoCrm | null;
  readonly canalPreferido: string | null;
}

export interface ListaDeClientesDoCrm {
  readonly total: number;
  readonly clientes: readonly ClienteDoCrm[];
}
