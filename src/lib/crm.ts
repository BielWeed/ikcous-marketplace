/**
 * Funções PURAS do Início e do Dashboard CRM do painel.
 *
 * 1. Parsers defensivos das RPCs `painel_inicio`, `assinatura_da_loja_ler`,
 *    `crm_visao` e `crm_clientes` (todas devolvem `jsonb`; em
 *    `database.types.ts` são `Json`). Regra da casa: "não sei" nunca é zero —
 *    campo ausente ou fora da forma vira `null` e a tela diz "—".
 * 2. Segmentos RFM (rótulo, descrição, tom de cor) e o texto pronto de
 *    WhatsApp por segmento.
 * 3. Matemática de período (datas `YYYY-MM-DD` no fuso America/Sao_Paulo,
 *    o mesmo das RPCs) e formatadores de dinheiro/percentual/variação.
 *
 * Sem hook, sem Supabase, sem `import.meta.env`: tudo aqui é testável com
 * entrada e saída.
 */
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type {
  CanalDoCrm,
  ClienteDoCrm,
  EtapaDoPipeline,
  FormaDePagamentoDoCrm,
  IntervaloDeDatas,
  ListaDeClientesDoCrm,
  PeriodoDoCrm,
  ResumoDoSegmento,
  SegmentoCrm,
  VisaoDoCrm,
} from "@/types/crm";
import type {
  AssinaturaDaLoja,
  PainelInicio,
  PontoDaSerieDiaria,
  StatusDaAssinatura,
} from "@/types/painel";

// ─── Leitores de Json ────────────────────────────────────────────────────

type Registro = Readonly<Record<string, unknown>>;

const VAZIO: Registro = Object.freeze({});

function comoRegistro(valor: unknown): Registro | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Registro)
    : null;
}

/** `numeric` chega como número no jsonb; string numérica é aceita por defesa. */
function comoNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string" && valor.trim() !== "") {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : null;
  }
  return null;
}

/**
 * As taxas do `crm_visao` (recompra, receita recorrente, devolução) chegam
 * como FRAÇÃO de 0 a 1 (ex.: 0,2857); a tela mostra percentual (28,57).
 */
function comoPercentualDeFracao(valor: unknown): number | null {
  const fracao = comoNumero(valor);
  return fracao == null ? null : Math.round(fracao * 10_000) / 100;
}

function comoTexto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

function comoLista(valor: unknown): readonly unknown[] {
  return Array.isArray(valor) ? valor : [];
}

const PADRAO_DIA = /^\d{4}-\d{2}-\d{2}$/;

// ─── Início ──────────────────────────────────────────────────────────────

/** `contas_vencidas` é quantidade; um objeto `{quantidade}` também é lido. */
function lerContasVencidas(valor: unknown): number | null {
  const numero = comoNumero(valor);
  if (numero !== null) return numero;
  const registro = comoRegistro(valor);
  if (!registro) return null;
  return comoNumero(registro.quantidade) ?? comoNumero(registro.total);
}

/** `caixa_aberto` pode vir booleano ou como a sessão (`{id,...} | null`). */
function lerCaixaAberto(valor: unknown): boolean {
  if (typeof valor === "boolean") return valor;
  return comoRegistro(valor) !== null;
}

function lerSerieDiaria(valor: unknown): PontoDaSerieDiaria[] {
  const pontos: PontoDaSerieDiaria[] = [];
  for (const item of comoLista(valor)) {
    const registro = comoRegistro(item);
    const dia = comoTexto(registro?.dia);
    if (!registro || !dia || !PADRAO_DIA.test(dia)) continue;
    pontos.push({ dia, receita: comoNumero(registro.receita) ?? 0 });
  }
  return pontos.sort((a, b) => a.dia.localeCompare(b.dia));
}

/**
 * Garante os 14 pontos do minigráfico do Início mesmo se a série chegar
 * menor (o contrato de `painel_inicio()` sempre manda os 14 dias de
 * hoje-13 até hoje — migration `20261178000000_o_crm_e_o_inicio_leem_a_loja.sql`
 * ~346 — mas o parser não trava se um dia faltar). Ancora no MAIOR dia
 * RECEBIDO (não assume que o array chegue ordenado, nem usa "hoje" do
 * cliente, que pode divergir do servidor por um instante), e completa os
 * dias anteriores que faltarem com receita ZERO — dia sem venda é zero
 * medido, não "não sei". Série vazia continua vazia: a tela já lê isso como
 * "sem venda registrada".
 */
export function completarSerieDe14Dias(
  serie: readonly PontoDaSerieDiaria[],
): PontoDaSerieDiaria[] {
  if (serie.length === 0) return [];
  const porDia = new Map(serie.map((ponto) => [ponto.dia, ponto.receita]));
  const ultimoDia = serie.reduce(
    (maior, ponto) => (ponto.dia > maior ? ponto.dia : maior),
    serie[0].dia,
  );
  const completa: PontoDaSerieDiaria[] = [];
  for (let i = 13; i >= 0; i--) {
    const dia = somarDias(ultimoDia, -i);
    completa.push({ dia, receita: porDia.get(dia) ?? 0 });
  }
  return completa;
}

export function lerPainelInicio(json: unknown): PainelInicio | null {
  const raiz = comoRegistro(json);
  if (!raiz) return null;
  const hoje = comoRegistro(raiz.hoje) ?? VAZIO;
  const mes = comoRegistro(raiz.mes) ?? VAZIO;
  const pendencias = comoRegistro(raiz.pendencias) ?? VAZIO;

  return {
    hoje: {
      receita: comoNumero(hoje.receita),
      online: comoNumero(hoje.online),
      presencial: comoNumero(hoje.presencial),
      pedidos: comoNumero(hoje.pedidos),
      receitaSemanaPassada: comoNumero(hoje.receita_semana_passada),
    },
    mes: {
      receita: comoNumero(mes.receita),
      receitaMesAnterior: comoNumero(mes.receita_mes_anterior),
      pedidos: comoNumero(mes.pedidos),
      ticketMedio: comoNumero(mes.ticket_medio),
      lucroEstimado: comoNumero(mes.lucro_estimado),
    },
    saldoTotal: comoNumero(raiz.saldo_total),
    aReceber7d: comoNumero(raiz.a_receber_7d),
    aPagar7d: comoNumero(raiz.a_pagar_7d),
    contasVencidas: lerContasVencidas(raiz.contas_vencidas),
    pendencias: {
      pedidosParaPreparar: comoNumero(pendencias.pedidos_para_preparar),
      devolucoesAbertas: comoNumero(pendencias.devolucoes_abertas),
      caixaAberto: lerCaixaAberto(pendencias.caixa_aberto),
      estoqueBaixo: comoNumero(pendencias.estoque_baixo),
    },
    serie14d: lerSerieDiaria(raiz.serie_14d),
  };
}

const STATUS_DA_ASSINATURA: readonly StatusDaAssinatura[] = [
  "ativa",
  "teste",
  "pendente",
  "atrasada",
  "suspensa",
  "cancelada",
];

function lerStatusDaAssinatura(valor: unknown): StatusDaAssinatura | null {
  const texto = comoTexto(valor)?.toLowerCase();
  return STATUS_DA_ASSINATURA.find((status) => status === texto) ?? null;
}

/** Só `https://` abre em nova aba — `javascript:` e afins morrem aqui. */
function lerUrlSegura(valor: unknown): string | null {
  const texto = comoTexto(valor);
  if (!texto) return null;
  try {
    return new URL(texto).protocol === "https:" ? texto : null;
  } catch {
    return null;
  }
}

/**
 * `assinatura_da_loja_ler()` devolve `null` quando o projeto de cobrança
 * ainda não gravou a linha da loja — e o card diz isso com todas as letras.
 */
export function lerAssinaturaDaLoja(json: unknown): AssinaturaDaLoja | null {
  const raiz = comoRegistro(json);
  if (!raiz) return null;
  return {
    plano: comoTexto(raiz.plano),
    status: lerStatusDaAssinatura(raiz.status),
    valorMensal: comoNumero(raiz.valor_mensal),
    ciclo: comoTexto(raiz.ciclo),
    inicioEm: comoTexto(raiz.inicio_em),
    proximaCobrancaEm: comoTexto(raiz.proxima_cobranca_em),
    testeAte: comoTexto(raiz.teste_ate),
    recursos: comoLista(raiz.recursos)
      .map((recurso) => comoTexto(recurso))
      .filter((recurso): recurso is string => recurso !== null),
    gerenciarUrl: lerUrlSegura(raiz.gerenciar_url),
    suporteWhatsapp: comoTexto(raiz.suporte_whatsapp),
    atualizadoEm: comoTexto(raiz.atualizado_em),
  };
}

// ─── CRM ─────────────────────────────────────────────────────────────────

export const SEGMENTOS_DO_CRM: readonly SegmentoCrm[] = [
  "campeoes",
  "leais",
  "ativos",
  "novos",
  "promissores",
  "precisam_atencao",
  "quase_dormindo",
  "em_risco",
  "nao_pode_perder",
  "hibernando",
  "pediu_nao_pagou",
  "nunca_comprou",
];

function lerSegmento(valor: unknown): SegmentoCrm | null {
  const texto = comoTexto(valor);
  return SEGMENTOS_DO_CRM.find((segmento) => segmento === texto) ?? null;
}

function lerCanais(valor: unknown): CanalDoCrm[] {
  const canais: CanalDoCrm[] = [];
  for (const item of comoLista(valor)) {
    const registro = comoRegistro(item);
    const canal = comoTexto(registro?.canal);
    if (!registro || !canal) continue;
    const receita = comoNumero(registro.receita) ?? 0;
    const pedidos = comoNumero(registro.pedidos) ?? 0;
    canais.push({
      canal,
      receita,
      pedidos,
      ticketMedio:
        comoNumero(registro.ticket_medio) ??
        (pedidos > 0 ? receita / pedidos : 0),
    });
  }
  return canais;
}

function lerFormas(valor: unknown): FormaDePagamentoDoCrm[] {
  const formas: FormaDePagamentoDoCrm[] = [];
  for (const item of comoLista(valor)) {
    const registro = comoRegistro(item);
    const forma = comoTexto(registro?.forma);
    if (!registro || !forma) continue;
    formas.push({
      forma,
      receita: comoNumero(registro.receita) ?? 0,
      pedidos: comoNumero(registro.pedidos) ?? 0,
    });
  }
  return formas.sort((a, b) => b.receita - a.receita);
}

function lerPipeline(valor: unknown): EtapaDoPipeline[] {
  const etapas: EtapaDoPipeline[] = [];
  for (const item of comoLista(valor)) {
    const registro = comoRegistro(item);
    const status = comoTexto(registro?.status);
    if (!registro || !status) continue;
    etapas.push({
      status,
      quantidade: comoNumero(registro.quantidade) ?? 0,
      maisAntigoEm: comoTexto(registro.mais_antigo_em),
    });
  }
  return etapas;
}

function lerSegmentos(valor: unknown): ResumoDoSegmento[] {
  const resumos: ResumoDoSegmento[] = [];
  for (const item of comoLista(valor)) {
    const registro = comoRegistro(item);
    const segmento = lerSegmento(registro?.segmento);
    if (!registro || !segmento) continue;
    resumos.push({
      segmento,
      clientes: comoNumero(registro.clientes) ?? 0,
      receita: comoNumero(registro.receita) ?? 0,
    });
  }
  return resumos;
}

export function lerVisaoDoCrm(json: unknown): VisaoDoCrm | null {
  const raiz = comoRegistro(json);
  if (!raiz) return null;
  const kpis = comoRegistro(raiz.kpis) ?? VAZIO;
  const funil = comoRegistro(raiz.funil) ?? VAZIO;
  return {
    kpis: {
      receita: comoNumero(kpis.receita),
      receitaAnterior: comoNumero(kpis.receita_anterior),
      pedidos: comoNumero(kpis.pedidos),
      pedidosAnterior: comoNumero(kpis.pedidos_anterior),
      ticketMedio: comoNumero(kpis.ticket_medio),
      ticketMedioAnterior: comoNumero(kpis.ticket_medio_anterior),
      clientesCompradores: comoNumero(kpis.clientes_compradores),
      clientesNovos: comoNumero(kpis.clientes_novos),
      taxaRecompra: comoPercentualDeFracao(kpis.taxa_recompra),
      receitaRecorrentePct: comoPercentualDeFracao(kpis.receita_recorrente_pct),
      ltvMedio: comoNumero(kpis.ltv_medio),
      receitaEmRisco: comoNumero(kpis.receita_em_risco),
      taxaDevolucao: comoPercentualDeFracao(kpis.taxa_devolucao),
    },
    canais: lerCanais(raiz.canais),
    formas: lerFormas(raiz.formas),
    funil: {
      visitas: comoNumero(funil.visitas),
      produtosVistos: comoNumero(funil.produtos_vistos),
      carrinhos: comoNumero(funil.carrinhos),
      pedidosCriados: comoNumero(funil.pedidos_criados),
      pedidosPagos: comoNumero(funil.pedidos_pagos),
    },
    pipeline: lerPipeline(raiz.pipeline),
    segmentos: lerSegmentos(raiz.segmentos),
  };
}

function lerCliente(item: unknown, posicao: number): ClienteDoCrm | null {
  const registro = comoRegistro(item);
  if (!registro) return null;
  const userId = comoTexto(registro.user_id);
  const whatsapp = comoTexto(registro.whatsapp);
  const pedidos = comoNumero(registro.pedidos) ?? 0;
  const receita = comoNumero(registro.receita) ?? 0;
  return {
    chave:
      comoTexto(registro.chave) ?? userId ?? whatsapp ?? `linha-${posicao}`,
    userId,
    nome: comoTexto(registro.nome),
    whatsapp,
    email: comoTexto(registro.email),
    pedidos,
    receita,
    ticketMedio:
      comoNumero(registro.ticket_medio) ??
      (pedidos > 0 ? receita / pedidos : null),
    primeiraCompra: comoTexto(registro.primeira_compra),
    ultimaCompra: comoTexto(registro.ultima_compra),
    diasSemComprar: comoNumero(registro.dias_sem_comprar),
    r: comoNumero(registro.r),
    f: comoNumero(registro.f),
    m: comoNumero(registro.m),
    segmento: lerSegmento(registro.segmento),
    canalPreferido: comoTexto(registro.canal_preferido),
    // Chave nova da migration 83 — ausente numa RPC ainda na 78 (banco da
    // loja sem a migration aplicada); `comoNumero` já devolve `null` nesse
    // caso, então nenhuma tela quebra.
    valorEmAberto: comoNumero(registro.valor_em_aberto),
    cadastradoEm: comoTexto(registro.cadastrado_em),
  };
}

export function lerClientesDoCrm(json: unknown): ListaDeClientesDoCrm | null {
  const raiz = comoRegistro(json);
  if (!raiz) return null;
  const clientes = comoLista(raiz.clientes)
    .map((item, posicao) => lerCliente(item, posicao))
    .filter((cliente): cliente is ClienteDoCrm => cliente !== null);
  return {
    total: comoNumero(raiz.total) ?? clientes.length,
    clientes,
  };
}

// ─── Segmentos: rótulo, descrição e tom ──────────────────────────────────

/** Tom visual — agrupa segmentos pela SAÚDE da relação, não por identidade. */
export type TomDoCrm = "otimo" | "crescendo" | "atencao" | "risco" | "neutro";

interface InfoDoSegmento {
  readonly rotulo: string;
  readonly descricao: string;
  readonly tom: TomDoCrm;
}

export function infoDoSegmento(segmento: SegmentoCrm): InfoDoSegmento {
  switch (segmento) {
    case "campeoes":
      return {
        rotulo: "Campeões",
        descricao: "Compram muito, sempre e há pouco tempo",
        tom: "otimo",
      };
    case "leais":
      return {
        rotulo: "Leais",
        descricao: "Voltam com frequência e gastam bem",
        tom: "otimo",
      };
    case "ativos":
      return {
        rotulo: "Ativos",
        descricao: "Compraram há pouco e já repetiram",
        tom: "otimo",
      };
    case "novos":
      return {
        rotulo: "Novos",
        descricao: "Primeira compra recente",
        tom: "crescendo",
      };
    case "promissores":
      return {
        rotulo: "Promissores",
        descricao: "Recentes, com potencial de repetir",
        tom: "crescendo",
      };
    case "precisam_atencao":
      return {
        rotulo: "Precisam de atenção",
        descricao: "Bons clientes esfriando",
        tom: "atencao",
      };
    case "quase_dormindo":
      return {
        rotulo: "Quase dormindo",
        descricao: "Sumindo aos poucos",
        tom: "atencao",
      };
    case "em_risco":
      return {
        rotulo: "Em risco",
        descricao: "Compravam bem e pararam",
        tom: "risco",
      };
    case "nao_pode_perder":
      return {
        rotulo: "Não pode perder",
        descricao: "Os melhores de antes, parados há tempo",
        tom: "risco",
      };
    case "hibernando":
      return {
        rotulo: "Hibernando",
        descricao: "Pouca compra, há muito tempo",
        tom: "neutro",
      };
    case "pediu_nao_pagou":
      return {
        rotulo: "Pediu e não pagou",
        // Nunca "nenhum pagamento foi confirmado": o grupo também pega
        // quem PAGOU e depois teve o pedido cancelado/estornado/devolvido
        // (revisão de risco, achado 3) — a régua de "compra paga válida" é
        // a mesma de crm__vendas (payment_status reconhecido + pedido não
        // cancelado/devolvido).
        descricao: "Fez pedido, mas não tem compra paga válida",
        tom: "atencao",
      };
    case "nunca_comprou":
      return {
        rotulo: "Cadastrado, nunca comprou",
        descricao: "Tem conta na loja, mas ainda não fez o primeiro pedido",
        tom: "neutro",
      };
  }
}

interface ClassesDoTom {
  /** Crachá com texto (borda + fundo + tinta clara legível no escuro). */
  readonly cracha: string;
  /** Ponto/barra que acompanha o texto — a cor nunca é a única pista. */
  readonly marca: string;
}

export function classesDoTom(tom: TomDoCrm): ClassesDoTom {
  switch (tom) {
    case "otimo":
      return {
        cracha: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
        marca: "bg-emerald-400",
      };
    case "crescendo":
      return {
        cracha: "border-sky-500/25 bg-sky-500/10 text-sky-300",
        marca: "bg-sky-400",
      };
    case "atencao":
      return {
        cracha: "border-amber-500/25 bg-amber-500/10 text-amber-300",
        marca: "bg-amber-400",
      };
    case "risco":
      return {
        cracha: "border-rose-500/25 bg-rose-500/10 text-rose-300",
        marca: "bg-rose-400",
      };
    case "neutro":
      return {
        cracha: "border-white/10 bg-zinc-800/60 text-zinc-300",
        marca: "bg-zinc-500",
      };
  }
}

// ─── WhatsApp ────────────────────────────────────────────────────────────

function primeiroNome(nome: string | null | undefined): string | null {
  const primeiro = nome?.trim().split(/\s+/)[0];
  return primeiro ? primeiro : null;
}

/**
 * Texto pronto por segmento. Nada de prometer desconto ou cupom que a loja
 * não criou: a mensagem abre a conversa, e o lojista edita antes de enviar.
 */
export function mensagemDoSegmento(
  segmento: SegmentoCrm | null,
  { nome, loja }: { nome: string | null; loja: string },
): string {
  const quem = primeiroNome(nome);
  const oi = quem
    ? `Oi, ${quem}! Aqui é da ${loja}.`
    : `Oi! Aqui é da ${loja}.`;
  switch (segmento) {
    case "campeoes":
    case "leais":
      return `${oi} Obrigado por comprar sempre com a gente! Chegaram novidades e lembrei de você primeiro. Quer dar uma olhada?`;
    case "ativos":
    case "promissores":
      return `${oi} Que bom ter você por perto! Chegaram novidades que combinam com o que você levou. Posso te mostrar?`;
    case "novos":
      return `${oi} Obrigado pela sua primeira compra! Deu tudo certo com o seu pedido? Qualquer dúvida, é só me chamar por aqui.`;
    case "precisam_atencao":
    case "quase_dormindo":
      return `${oi} Faz um tempinho que você não passa por aqui e sentimos sua falta. Temos novidades — quer ver?`;
    case "em_risco":
    case "nao_pode_perder":
      return `${oi} Você é um cliente muito especial para nós e sentimos sua falta. Posso te mostrar o que chegou de novo?`;
    case "hibernando":
      return `${oi} Tudo bem? Faz tempo! Passando para te mostrar as novidades da loja.`;
    case "pediu_nao_pagou":
      // Sem afirmar nada sobre pagamento (achado 3, revisão de risco): o
      // grupo também inclui quem pagou e teve o pedido cancelado/estornado/
      // devolvido depois — dizer "o pagamento não foi concluído" seria
      // falso para essa gente.
      return `${oi} Vi que você fez um pedido com a gente. Ficou alguma dúvida? Posso te ajudar a finalizar a compra?`;
    case "nunca_comprou":
      return `${oi} Obrigado por criar sua conta na loja! Quando quiser dar uma olhada nos produtos, é só me chamar por aqui.`;
    default:
      return `${oi} Tudo bem? Posso ajudar com alguma coisa?`;
  }
}

/**
 * `https://wa.me/55<dígitos>?text=<mensagem>` — ou `null` quando o número
 * não abre conversa (mesma régua de `linkWhatsappDoCliente`: < 10 dígitos
 * não vira botão).
 */
export function linkWhatsappDoCrm(
  whatsapp: string | null | undefined,
  texto: string,
): string | null {
  const base = linkWhatsappDoCliente(whatsapp);
  if (!base) return null;
  return `${base}?text=${encodeURIComponent(texto)}`;
}

// ─── Período ─────────────────────────────────────────────────────────────

export const PERIODOS_DO_CRM: readonly {
  readonly id: PeriodoDoCrm;
  readonly rotulo: string;
  /** Como o período anterior é chamado ao lado da variação. */
  readonly comparacao: string;
}[] = [
  { id: "hoje", rotulo: "Hoje", comparacao: "vs. ontem" },
  { id: "7d", rotulo: "7 dias", comparacao: "vs. 7 dias antes" },
  { id: "30d", rotulo: "30 dias", comparacao: "vs. 30 dias antes" },
  { id: "90d", rotulo: "90 dias", comparacao: "vs. 90 dias antes" },
  { id: "mes", rotulo: "Mês", comparacao: "vs. mês anterior" },
  { id: "ano", rotulo: "Ano", comparacao: "vs. ano anterior" },
];

const FORMATO_DIA_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A data de HOJE em São Paulo, `YYYY-MM-DD` (o fuso das RPCs). */
export function diaEmSaoPaulo(agora: Date): string {
  const partes = FORMATO_DIA_SP.formatToParts(agora);
  const pegar = (tipo: string) =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${pegar("year")}-${pegar("month")}-${pegar("day")}`;
}

function somarDias(dia: string, quantidade: number): string {
  const [ano, mes, data] = dia.split("-").map(Number);
  const utc = Date.UTC(ano, mes - 1, data) + quantidade * 86_400_000;
  return new Date(utc).toISOString().slice(0, 10);
}

export function intervaloDoPeriodo(
  periodo: PeriodoDoCrm,
  agora: Date = new Date(),
): IntervaloDeDatas {
  const fim = diaEmSaoPaulo(agora);
  switch (periodo) {
    case "hoje":
      return { inicio: fim, fim };
    case "7d":
      return { inicio: somarDias(fim, -6), fim };
    case "30d":
      return { inicio: somarDias(fim, -29), fim };
    case "90d":
      return { inicio: somarDias(fim, -89), fim };
    case "mes":
      return { inicio: `${fim.slice(0, 8)}01`, fim };
    case "ano":
      return { inicio: `${fim.slice(0, 5)}01-01`, fim };
  }
}

// ─── Formatadores ────────────────────────────────────────────────────────

const MOEDA = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const MOEDA_COMPACTA = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const INTEIRO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** "—" é "não sei"; zero medido aparece como R$ 0,00. */
export function formatarMoeda(valor: number | null | undefined): string {
  return valor == null ? "—" : MOEDA.format(valor);
}

/** Compacta só a partir de R$ 10 mil — valor pequeno fica exato. */
export function formatarMoedaCompacta(
  valor: number | null | undefined,
): string {
  if (valor == null) return "—";
  return Math.abs(valor) >= 10_000
    ? MOEDA_COMPACTA.format(valor)
    : MOEDA.format(valor);
}

export function formatarInteiro(valor: number | null | undefined): string {
  return valor == null ? "—" : INTEIRO.format(valor);
}

export function formatarPercentual(
  valor: number | null | undefined,
  casas = 1,
): string {
  if (valor == null) return "—";
  return `${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  })}%`;
}

/**
 * Variação percentual de `atual` sobre `anterior`. `null` quando não há
 * base honesta: um dos dois é "não sei", ou o anterior é zero (de zero para
 * qualquer coisa não é "+∞%").
 */
export function variacaoPercentual(
  atual: number | null | undefined,
  anterior: number | null | undefined,
): number | null {
  if (atual == null || anterior == null || anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

/** "+12,3%", "−4%" (sinal de menos de verdade), "0%". */
export function formatarVariacao(pct: number): string {
  const arredondado = Math.round(pct * 10) / 10;
  const corpo = Math.abs(arredondado).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  });
  if (arredondado > 0) return `+${corpo}%`;
  if (arredondado < 0) return `−${corpo}%`;
  return "0%";
}

/** `YYYY-MM-DD` ou instante ISO → "26/09/2026" (dia em São Paulo). */
export function formatarData(valor: string | null | undefined): string {
  if (!valor) return "—";
  if (PADRAO_DIA.test(valor)) {
    const [ano, mes, dia] = valor.split("-");
    return `${dia}/${mes}/${ano}`;
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "—";
  const [ano, mes, dia] = diaEmSaoPaulo(data).split("-");
  return `${dia}/${mes}/${ano}`;
}

// ─── Erro ────────────────────────────────────────────────────────────────

/**
 * Frase que a lojista lê quando uma RPC do Início/CRM falha. Só nomeia a
 * causa quando o erro a distingue sem dúvida; o resto cai na frase genérica
 * (o erro bruto segue no console de quem chamou).
 */
export function mensagemDeErroDoPainel(erro: unknown, acao: string): string {
  const sinal = comoRegistro(erro) ?? VAZIO;
  const codigo = comoTexto(sinal.code) ?? "";
  const texto = comoTexto(sinal.message) ?? "";
  // PGRST202 (PostgREST) / 42883 (Postgres): a função não existe — a
  // migration deste painel ainda não foi aplicada no banco da loja.
  if (codigo === "PGRST202" || codigo === "42883") {
    return "Estes números ainda não foram ativados no banco da loja. Assim que a atualização for aplicada, eles aparecem aqui.";
  }
  if (codigo === "42501" || /permission denied/i.test(texto)) {
    return "Sem permissão para ver estes números. Confirme que você entrou com a conta de administradora da loja.";
  }
  if (
    /failed to fetch|networkerror|fetch failed|load failed|network request failed/i.test(
      texto,
    )
  ) {
    return "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
  }
  return `Não foi possível ${acao} agora. Tente de novo em instantes.`;
}

// ─── Rótulos ─────────────────────────────────────────────────────────────

export function rotuloDoCanal(canal: string | null | undefined): string {
  if (canal === "online") return "App (online)";
  if (canal === "presencial") return "Loja física";
  return canal ?? "—";
}

/**
 * Rótulo por forma de pagamento. Os valores REAIS de `crm_visao.formas[].forma`
 * vêm de `fin__forma_do_pedido` (migration
 * `20261177000000_o_financeiro_da_loja_nasce.sql:308-318`): só `pix`,
 * `credito`, `debito`, `dinheiro`, `cartao` ou `outro` — a função nunca
 * devolve `cash`/`card`/`online` (esses são o `payment_method`/
 * `metodo_online` BRUTOS de entrada, não a saída). `cash`/`card`/`online`
 * ficam como sinônimos defensivos (nunca custam nada manter, e cobrem
 * quem porventura chamar esta função com o valor bruto por engano).
 */
export function rotuloDaFormaDePagamento(forma: string): string {
  switch (forma) {
    case "pix":
      return "PIX";
    case "credito":
      return "Cartão de crédito";
    case "debito":
      return "Cartão de débito";
    case "dinheiro":
    case "cash": // sinônimo defensivo — nunca sai de fin__forma_do_pedido
      return "Dinheiro";
    case "cartao":
    case "card": // sinônimo defensivo — idem
      return "Cartão";
    case "outro":
      return "Outra forma";
    case "online": // sinônimo defensivo — idem (vira pix/credito/debito)
      return "Online (Mercado Pago)";
    default:
      return forma;
  }
}

export function rotuloDoStatusDoPedido(status: string): string {
  switch (status) {
    case "pending":
    case "new":
      return "Novo pedido";
    case "processing":
      return "Em separação";
    case "shipping":
      return "Em trânsito";
    case "delivered":
      return "Entregue";
    case "cancelled":
      return "Cancelado";
    default:
      return status;
  }
}

interface InfoDoStatusDaAssinatura {
  readonly rotulo: string;
  readonly tom: TomDoCrm;
}

export function infoDoStatusDaAssinatura(
  status: StatusDaAssinatura | null,
): InfoDoStatusDaAssinatura {
  switch (status) {
    case "ativa":
      return { rotulo: "Ativa", tom: "otimo" };
    case "teste":
      return { rotulo: "Em teste", tom: "crescendo" };
    case "pendente":
      return { rotulo: "Pagamento pendente", tom: "atencao" };
    case "atrasada":
      return { rotulo: "Atrasada", tom: "risco" };
    case "suspensa":
      return { rotulo: "Suspensa", tom: "risco" };
    case "cancelada":
      return { rotulo: "Cancelada", tom: "neutro" };
    default:
      return { rotulo: "Status desconhecido", tom: "neutro" };
  }
}

export function rotuloDoCiclo(ciclo: string | null): string {
  switch (ciclo?.toLowerCase()) {
    case "mensal":
      return "/mês";
    case "trimestral":
      return "/trimestre";
    case "semestral":
      return "/semestre";
    case "anual":
      return "/ano";
    case undefined:
      return "";
    default:
      return ` · ${ciclo}`;
  }
}

// --- canais e funil do CRM (visual 27/09) ---
//
// Funções puras do redesenho das abas Canais e Funil e pedidos
// (`docs/superpowers/specs/2026-09-27-crm-visual-profissional-design.md`).
// A regra que motivou todas elas: nunca inventar um número — canal sem
// venda é ZERO (não some), mas divisão sem base e conversão maluca (o
// "650% do passo anterior" que o dono viu) viram `null`, e a tela lê `null`
// como "—" ou como nota, nunca como dado.

/**
 * Os DOIS canais sempre presentes, na mesma ordem (app, depois loja
 * física) — canal sem venda no período não some da comparação, vira zero.
 */
export function garantirAppELoja(canais: readonly CanalDoCrm[]): {
  readonly online: CanalDoCrm;
  readonly presencial: CanalDoCrm;
} {
  const achar = (canal: string): CanalDoCrm =>
    canais.find((c) => c.canal === canal) ?? {
      canal,
      receita: 0,
      pedidos: 0,
      ticketMedio: 0,
    };
  return { online: achar("online"), presencial: achar("presencial") };
}

/**
 * `parte` como percentual de `total`. Sem base (total ≤ 0) é `null` — nunca
 * "0%", que pareceria uma fatia medida em vez de "não há o que dividir".
 */
export function percentualDoTotal(
  parte: number,
  total: number,
  casas = 0,
): number | null {
  if (total <= 0) return null;
  const fator = 10 ** casas;
  return Math.round((parte / total) * 100 * fator) / fator;
}

/** Ticket médio de uma forma de pagamento: receita ÷ pedidos, ao centavo. */
export function ticketPorForma(
  receita: number,
  pedidos: number,
): number | null {
  if (pedidos <= 0) return null;
  return Math.round((receita / pedidos) * 100) / 100;
}

/**
 * Conversão entre duas etapas DA MESMA UNIDADE. `> 100%` vira `null`: um
 * funil nunca mostra mais que o passo anterior (foi assim que "13 pedidos
 * criados, 2 carrinhos" virou "650% do passo anterior" — unidades
 * diferentes, pessoas × pedidos, nunca deveriam ter sido divididas).
 */
export function conversaoEntreEtapas(
  atual: number | null,
  anterior: number | null,
): number | null {
  if (atual == null || anterior == null || anterior <= 0 || atual < 0) {
    return null;
  }
  const percentual = Math.round((atual / anterior) * 1000) / 10;
  return percentual > 100 ? null : percentual;
}

/**
 * Conversão em venda do funil do app: vendas pagas ÷ pedidos criados no
 * período. Não se chama mais "taxa de pagamento" porque essa palavra ficava
 * falsa quando um pedido pago era depois estornado/cancelado: `pedidosPagos`
 * aqui é `crm__vendas` (exclui cancelado/devolvido e status de pagamento
 * fora de pago/pago_apos_expirar/recebido_na_entrega), mas `pedidosCriados`
 * conta TODO pedido criado no período — inclusive o que chegou a ser pago e
 * saiu depois. "Conversão em venda" descreve isso sem prometer que todo
 * pedido pago continua contado como pago para sempre.
 */
export function conversaoEmVenda(
  pedidosCriados: number | null,
  vendasPagas: number | null,
): number | null {
  return conversaoEntreEtapas(vendasPagas, pedidosCriados);
}

/**
 * Quantos pedidos criados no período NÃO viraram venda paga — a ação "Ver
 * pedidos" só aparece quando este número é positivo. Cobre as DUAS coortes:
 * quem nunca pagou e quem pagou e foi estornado/cancelado depois (ele sai
 * de `vendasPagas`, mas continua contado em `pedidosCriados`). `null`
 * quando alguma das duas etapas não é medida.
 */
export function pedidosSemVendaPaga(
  pedidosCriados: number | null,
  vendasPagas: number | null,
): number | null {
  if (pedidosCriados == null || vendasPagas == null) return null;
  return Math.max(0, pedidosCriados - vendasPagas);
}

/** Tom do destaque "Conversão em venda" do Funil do app — a cor reage ao
 * valor medido, não é sempre verde (o dono viu 0% pintado de verde, a
 * mesma cor de sucesso do resto do painel). ≥ 70% é saudável; entre 30% e
 * 70% é intermediário; abaixo de 30% chama atenção; sem taxa medida
 * (`null`, as duas etapas ainda não vieram) é neutro. */
export type TomDaTaxaDePagamento = "boa" | "mediana" | "baixa" | "neutra";

export function tomDaTaxaDePagamento(
  taxa: number | null,
): TomDaTaxaDePagamento {
  if (taxa == null) return "neutra";
  if (taxa >= 70) return "boa";
  if (taxa >= 30) return "mediana";
  return "baixa";
}

/**
 * Nota "X ainda não são medidos" do Funil do app — cita só as etapas de
 * fato ausentes (`visitas`/`produtosVistos`), nunca as três que o funil já
 * mede (carrinhos, pedidos criados, pedidos pagos). Antes desta função, a
 * nota comparava o número de etapas MEDIDAS contra `ETAPAS_MEDIDAS.length`
 * — uma conta que nunca aponta para visitas/produtos vistos (que nem
 * entram nessa lista) e por isso a nota nunca aparecia.
 */
export function notaDeEtapasNaoMedidas(funil: {
  readonly visitas: number | null;
  readonly produtosVistos: number | null;
}): string | null {
  const semVisitas = funil.visitas == null;
  const semProdutosVistos = funil.produtosVistos == null;
  if (semVisitas && semProdutosVistos) {
    return "Visitas e produtos vistos ainda não são medidos.";
  }
  if (semVisitas) return "Visitas ainda não são medidas.";
  if (semProdutosVistos) return "Produtos vistos ainda não são medidos.";
  return null;
}

/** Frase de leitura do cartão "App × loja física": quem vendeu mais. */
export function fraseLeituraDosCanais(
  online: CanalDoCrm,
  presencial: CanalDoCrm,
): string {
  const total = online.receita + presencial.receita;
  if (total <= 0) return "Nenhuma venda no período.";
  const pctOnline = Math.round((online.receita / total) * 100);
  const pctPresencial = 100 - pctOnline;
  if (Math.abs(pctOnline - pctPresencial) <= 10) {
    return "App e loja física dividem a receita quase igual neste período.";
  }
  return pctOnline > pctPresencial
    ? `O app fez ${pctOnline}% da receita do período.`
    : `A loja física fez ${pctPresencial}% da receita do período.`;
}

/** Frase de leitura do cartão "Formas de pagamento": a forma líder. */
export function fraseLeituraDasFormas(
  formas: readonly FormaDePagamentoDoCrm[],
): string | null {
  const total = formas.reduce((soma, f) => soma + f.receita, 0);
  if (total <= 0) return null;
  const lider = [...formas].sort((a, b) => b.receita - a.receita)[0];
  const pct = Math.round((lider.receita / total) * 100);
  return `${rotuloDaFormaDePagamento(lider.forma)} é ${pct}% da receita do período.`;
}

/** "81 dias", "1 dia" — o selo de pedido parado escreve por extenso. */
export function diasPorExtenso(dias: number): string {
  const inteiro = Math.max(0, Math.floor(dias));
  return `${inteiro} ${inteiro === 1 ? "dia" : "dias"}`;
}

/**
 * Idade por extenso — "agora", "12 minutos", "5 horas", "3 dias" — nunca a
 * abreviação "min"/"h"/"d" (a antiga `idadeCurta`, removida por falta de
 * uso: só o pipeline de "mais antigo há" e o selo "parado" mediam idade, e
 * os dois já usam esta versão por extenso). Dias reaproveita
 * `diasPorExtenso`.
 */
export function idadePorExtenso(
  iso: string | null | undefined,
  agora: number = Date.now(),
): string | null {
  if (!iso) return null;
  const instante = Date.parse(iso);
  if (Number.isNaN(instante)) return null;
  const minutos = Math.max(0, Math.floor((agora - instante) / 60_000));
  if (minutos < 1) return "agora";
  if (minutos < 60) {
    return `${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  }
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} ${horas === 1 ? "hora" : "horas"}`;
  return diasPorExtenso(horas / 24);
}

/**
 * Uma sequência de etapas do funil é monotônica quando NUNCA sobe (cada
 * etapa ≤ a anterior). Quando falsa, uma etapa é maior que a anterior — o
 * sinal de que as unidades são diferentes (pessoas × pedidos, o caso real
 * "carrinhos 2 → pedidos criados 13") — e uma barra com largura
 * proporcional alargaria em vez de afunilar, parecendo quebrada.
 */
export function funilEhMonotonico(valores: readonly number[]): boolean {
  let anterior: number | null = null;
  for (const valor of valores) {
    if (anterior != null && valor > anterior) return false;
    anterior = valor;
  }
  return true;
}

/** Status que já saíram da fila — não pertencem a "Pedidos em aberto agora". */
const STATUS_FECHADOS_DO_PIPELINE = new Set(["delivered", "cancelled"]);

/**
 * Só os status ABERTOS do pipeline. Lista NEGATIVA de propósito: um status
 * novo que a UI ainda não conhece fica visível (falha aberta) em vez de
 * sumir da tela por não estar numa lista positiva desatualizada.
 */
export function pipelineEmAberto(
  etapas: readonly EtapaDoPipeline[],
): EtapaDoPipeline[] {
  return etapas.filter(
    (etapa) => !STATUS_FECHADOS_DO_PIPELINE.has(etapa.status),
  );
}

// --- clientes do CRM (visual 27/09) ---

/** Faixa de saúde da relação — agrupa os 12 segmentos da aba Clientes (10
 * RFM de quem comprou + os 2 grupos de quem ainda não comprou). */
export interface FaixaDeSegmentosDoCrm {
  readonly titulo: string;
  readonly segmentos: readonly SegmentoCrm[];
}

/**
 * As 4 faixas da grade "Segmentos de clientes" da aba Clientes, na ordem de
 * exibição: Melhores (quem compra bem) → Atenção (esfriando) → Perdendo (em
 * risco de sumir) → Ainda não compraram (pediu e não pagou / nunca comprou).
 */
export const FAIXAS_DE_SEGMENTOS_DO_CRM: readonly FaixaDeSegmentosDoCrm[] = [
  {
    titulo: "Melhores",
    segmentos: ["campeoes", "leais", "ativos", "novos", "promissores"],
  },
  {
    titulo: "Atenção",
    segmentos: ["precisam_atencao", "quase_dormindo"],
  },
  {
    titulo: "Perdendo",
    segmentos: ["em_risco", "nao_pode_perder", "hibernando"],
  },
  {
    // Pediu e não pagou vem PRIMEIRO — é a mais acionável (pedido do dono,
    // 27/09/2026: dá para recuperar a venda hoje, diferente de quem nunca
    // comprou).
    titulo: "Ainda não compraram",
    segmentos: ["pediu_nao_pagou", "nunca_comprou"],
  },
];

/**
 * Texto da linha de filtro ativo da aba Clientes ("Mostrando: Em risco · 2").
 * `null` quando nenhum segmento está selecionado (a lista mostra todos).
 */
export function textoDoFiltroDeSegmento(
  segmento: SegmentoCrm | null,
  clientes: number,
): string | null {
  if (!segmento) return null;
  return `Mostrando: ${infoDoSegmento(segmento).rotulo} · ${formatarInteiro(clientes)}`;
}

/**
 * Rótulo da coluna/campo de dinheiro da linha do cliente: `pediu_nao_pagou`
 * já qualifica o número como "em aberto" NO RÓTULO — o valor abaixo é só o
 * dinheiro (`textoDaReceitaDoCliente`), sem repetir "em aberto" ali (achado
 * 2, revisão de risco: o valor com `truncate` cortava "R$ 134,80 em ab…").
 * Os demais grupos continuam "Receita".
 */
export function rotuloDaReceita(segmento: SegmentoCrm | null): string {
  return segmento === "pediu_nao_pagou" ? "Em aberto" : "Receita";
}

/**
 * A célula de dinheiro da linha do cliente (migration 83, grupos novos):
 * comprador mostra a receita de sempre; `nunca_comprou` nunca teve valor
 * possível, sempre "—"; `pediu_nao_pagou` mostra só o valor em aberto (o
 * rótulo da célula, `rotuloDaReceita`, já diz "Em aberto") — "—" quando a
 * RPC ainda é a 78 (chave ausente, `valorEmAberto` chega `null` — "não sei"
 * nunca é zero) e um texto discreto (nunca "R$ 0,00" em destaque, que
 * pareceria um valor medido igual a qualquer outro) quando o valor em
 * aberto foi MEDIDO como zero (ex.: o único pedido "aguardando" expirou —
 * não sobrou nada para cobrar, mas a pessoa continua sem compra paga).
 */
export function textoDaReceitaDoCliente(
  cliente: {
    readonly segmento: SegmentoCrm | null;
    readonly receita: number;
    readonly valorEmAberto: number | null;
  },
  opcoes?: { readonly compacto?: boolean },
): string {
  // `compacto` (achado B, re-revisão de front): a coluna "Receita / Em
  // aberto" da TABELA desktop é estreita (~85px a 1024px) — "R$ 12.345,67"
  // por extenso (~96px) transborda e encosta em "Última compra". A partir
  // de R$ 10 mil, `formatarMoedaCompacta` abrevia ("R$ 12,3 mil"); abaixo
  // disso é igual a `formatarMoeda`. Os textos especiais ("—", "Sem valor
  // em aberto") nunca mudam — só o valor em dinheiro de verdade encolhe.
  const moeda = opcoes?.compacto ? formatarMoedaCompacta : formatarMoeda;
  if (cliente.segmento === "nunca_comprou") return "—";
  if (cliente.segmento === "pediu_nao_pagou") {
    if (cliente.valorEmAberto == null) return "—";
    if (cliente.valorEmAberto === 0) return "Sem valor em aberto";
    return moeda(cliente.valorEmAberto);
  }
  return moeda(cliente.receita);
}

/**
 * Rótulo da coluna/campo de data da linha do cliente: quem só pediu (e não
 * pagou) não tem "compra" nenhuma — o rótulo muda para "Último pedido"
 * (`ultimaCompra` carrega a data do pedido mais recente para este grupo,
 * migration 83). Os demais grupos continuam "Última compra".
 */
export function rotuloDeUltimaAtividade(segmento: SegmentoCrm | null): string {
  return segmento === "pediu_nao_pagou" ? "Último pedido" : "Última compra";
}

/**
 * Texto da mesma célula: "Nunca" para quem nunca comprou (mesmo que
 * `ultimaCompra` venha preenchida por engano — o segmento manda, não o
 * dado bruto); nos demais grupos, a data formatada de sempre.
 */
export function textoDeUltimaAtividade(cliente: {
  readonly segmento: SegmentoCrm | null;
  readonly ultimaCompra: string | null;
}): string {
  if (cliente.segmento === "nunca_comprou") return "Nunca";
  return formatarData(cliente.ultimaCompra);
}

/**
 * Rótulo curto do crachá de segmento na linha do cliente (achado 4, revisão
 * de risco): "Cadastrado, nunca comprou" espreme o nome no celular e trunca
 * até no desktop — a faixa "Ainda não compraram" já dá o contexto de
 * "cadastrado", então o crachá pode ser mais direto. O bloco da grade
 * continua com o rótulo longo (`infoDoSegmento`, cabe lá). Os demais
 * segmentos usam o mesmo rótulo de sempre.
 */
export function rotuloCurtoDoSegmento(segmento: SegmentoCrm): string {
  if (segmento === "nunca_comprou") return "Nunca comprou";
  return infoDoSegmento(segmento).rotulo;
}

/**
 * O texto pequeno de dinheiro dentro do bloco de segmento (grade "Segmentos
 * de clientes", achado 6 da revisão de risco). `nunca_comprou` nunca teve
 * nenhum valor possível — `null` faz o bloco NÃO desenhar a linha (mostrar
 * "R$ 0,00" sugeriria um valor medido que não existe). `pediu_nao_pagou`
 * qualifica o número como "em aberto" — é dinheiro em risco de virar venda,
 * nunca receita reconhecida, e sem o qualificador o bloco pareceria dizer
 * que aquela gente já gastou aquilo. Os demais segmentos mostram a receita
 * compacta de sempre.
 */
export function textoDoValorDoBlocoDeSegmento(
  segmento: SegmentoCrm,
  receita: number,
): string | null {
  if (segmento === "nunca_comprou") return null;
  if (segmento === "pediu_nao_pagou") {
    return `${formatarMoedaCompacta(receita)} em aberto`;
  }
  return formatarMoedaCompacta(receita);
}

/**
 * Só os 2 grupos novos (migration 83) podem estar ausentes de
 * `crm_visao.segmentos` — o banco de uma loja ainda na migration 78 nunca
 * manda essas 2 linhas. "Não sei" nunca é zero (regra da casa, topo deste
 * arquivo): se NENHUM dos dois aparece no resumo (e a tela não está mais
 * carregando), a faixa "Ainda não compraram" não desenha, em vez de mostrar
 * "0" — um dado inventado que pareceria "zero clientes nesse estado", não
 * "o banco não manda isso ainda". As faixas RFM de sempre (Melhores,
 * Atenção, Perdendo) sempre puderam legitimamente ter 0 clientes e
 * continuam desenhando sempre.
 */
export function faixaApareceNaGrade(
  faixa: FaixaDeSegmentosDoCrm,
  segmentosPresentes: ReadonlySet<SegmentoCrm>,
  carregando: boolean,
): boolean {
  if (faixa.titulo !== "Ainda não compraram") return true;
  if (carregando) return true;
  return faixa.segmentos.some((segmento) => segmentosPresentes.has(segmento));
}

// --- casca do CRM (visual 27/09) ---

const MESES_ABREVIADOS_DO_CRM = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

/**
 * `IntervaloDeDatas` → texto curto para ficar ao lado do trilho de período
 * ("28 ago – 26 set" em vez de seis palavras soltas sem contexto — spec
 * `2026-09-27-crm-visual-profissional-design.md`). Sem ano, a não ser que o
 * intervalo cruze a virada ("28 dez/2025 – 3 jan/2026"); início e fim iguais
 * (período "Hoje") mostram só um lado.
 */
export function formatarIntervaloCurto(intervalo: IntervaloDeDatas): string {
  const formatarLado = (dia: string, comAno: boolean) => {
    const [ano, mes, data] = dia.split("-").map(Number);
    const rotuloMes = MESES_ABREVIADOS_DO_CRM[mes - 1] ?? "";
    return comAno ? `${data} ${rotuloMes}/${ano}` : `${data} ${rotuloMes}`;
  };
  if (intervalo.inicio === intervalo.fim) {
    return formatarLado(intervalo.fim, false);
  }
  const cruzaAno = intervalo.inicio.slice(0, 4) !== intervalo.fim.slice(0, 4);
  return `${formatarLado(intervalo.inicio, cruzaAno)} – ${formatarLado(intervalo.fim, cruzaAno)}`;
}
