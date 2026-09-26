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

/** Idade curta de um instante: "agora", "12 min", "5 h", "3 d". */
export function idadeCurta(
  iso: string | null | undefined,
  agora: number = Date.now(),
): string | null {
  if (!iso) return null;
  const instante = Date.parse(iso);
  if (Number.isNaN(instante)) return null;
  const minutos = Math.max(0, Math.floor((agora - instante) / 60_000));
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h`;
  return `${Math.floor(horas / 24)} d`;
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

export function rotuloDaFormaDePagamento(forma: string): string {
  switch (forma) {
    case "online":
      return "Online (Mercado Pago)";
    case "pix":
      return "PIX";
    case "card":
      return "Cartão";
    case "credito":
      return "Cartão de crédito";
    case "debito":
      return "Cartão de débito";
    case "cash":
      return "Dinheiro";
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
