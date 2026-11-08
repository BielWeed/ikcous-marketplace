/**
 * Cupons que o checkout MOSTRA (frente B, 28/09/2026 — pedido do dono:
 * "detectar os cupons que estão liberados para uso, inclusive os exclusivos,
 * tudo bonitinho, para que seja mais claro e o cliente possa usar").
 *
 * Quem decide QUAIS cupons aparecem é o servidor (`cupons_do_checkout`,
 * migration 20261187000000): só os que o lojista pôs na vitrine e os
 * exclusivos DA própria conta — nunca o secreto, nunca o exclusivo de outra
 * pessoa. Este módulo só LÊ a resposta (defensivo: a linha que não tem a
 * forma esperada é descartada, nunca "consertada") e escreve o texto que a
 * cliente lê. A validação que vale continua no servidor, no toque de
 * "Aplicar" e na criação do pedido.
 */

export interface CupomDisponivel {
  readonly codigo: string;
  readonly tipo: "percentage" | "fixed";
  /** % (tipo percentage) ou R$ (tipo fixed). */
  readonly valor: number;
  /** Compra mínima em PRODUTOS (0 = sem mínimo). */
  readonly minimo: number;
  /** ISO — `null` = sem prazo. */
  readonly validoAte: string | null;
  readonly exclusivo: boolean;
  /** O subtotal de agora já bate o mínimo. */
  readonly aplica: boolean;
  /** Quanto falta em produtos (0 quando `aplica`). */
  readonly falta: number;
  /** Quanto o cupom desconta do subtotal de agora (0 quando não `aplica`). */
  readonly desconto: number;
}

function numeroFinito(valor: unknown): number | null {
  const n = typeof valor === "string" ? Number(valor) : valor;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Lê a resposta crua da RPC. Linha fora do contrato é DESCARTADA. */
export function lerCuponsDoCheckout(dados: unknown): CupomDisponivel[] {
  if (!Array.isArray(dados)) return [];
  const cupons: CupomDisponivel[] = [];
  const vistos = new Set<string>();
  for (const linha of dados) {
    if (typeof linha !== "object" || linha === null) continue;
    const l = linha as Record<string, unknown>;
    const codigo = typeof l.codigo === "string" ? l.codigo.trim() : "";
    const tipo = l.tipo;
    const valor = numeroFinito(l.valor);
    const minimo = numeroFinito(l.minimo) ?? 0;
    const falta = numeroFinito(l.falta) ?? 0;
    const desconto = numeroFinito(l.desconto) ?? 0;
    if (!codigo || vistos.has(codigo.toUpperCase())) continue;
    if (tipo !== "percentage" && tipo !== "fixed") continue;
    if (valor === null || valor <= 0) continue;
    const validoAte =
      typeof l.valido_ate === "string" &&
      !Number.isNaN(new Date(l.valido_ate).getTime())
        ? l.valido_ate
        : null;
    vistos.add(codigo.toUpperCase());
    cupons.push({
      codigo,
      tipo,
      valor,
      minimo: Math.max(minimo, 0),
      validoAte,
      exclusivo: l.exclusivo === true,
      aplica: l.aplica === true,
      falta: Math.max(falta, 0),
      desconto: Math.max(desconto, 0),
    });
  }
  return cupons;
}

const reais = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** "R$ 15,00" — mesmo formato do resto do checkout. */
export function emReais(valor: number): string {
  return reais.format(valor);
}

/** "R$ 15" quando é inteiro, "R$ 15,90" quando não — para o selo grande. */
function reaisCurtos(valor: number): string {
  // Arredonda a centavos antes de testar: 14.999 não é inteiro, então saía
  // "R$ 15,00" em vez de "R$ 15".
  const arredondado = Math.round(valor * 100) / 100;
  const casas = Number.isInteger(arredondado) ? 0 : 2;
  return `R$ ${arredondado.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}`;
}

/** "10%" / "12,5%". A loja e o painel do lojista usam esta mesma função. */
export function porcentagem(valor: number): string {
  const arredondado = Math.round(valor * 100) / 100;
  return `${String(arredondado).replace(".", ",")}%`;
}

/** O número grande do cartão: "10%" ou "R$ 15". */
export function destaqueDoCupom(
  cupom: Pick<CupomDisponivel, "tipo" | "valor">,
): string {
  return cupom.tipo === "percentage"
    ? porcentagem(cupom.valor)
    : reaisCurtos(cupom.valor);
}

/** "10% OFF acima de R$ 100,00" / "R$ 15,00 OFF em qualquer compra". */
export function descricaoDoCupom(
  cupom: Pick<CupomDisponivel, "tipo" | "valor" | "minimo">,
): string {
  const desconto =
    cupom.tipo === "percentage"
      ? `${porcentagem(cupom.valor)} OFF`
      : `${emReais(cupom.valor)} OFF`;
  return cupom.minimo > 0
    ? `${desconto} acima de ${emReais(cupom.minimo)}`
    : `${desconto} em qualquer compra`;
}

// O dia no calendário da LOJA (Brasília), não no do aparelho: o servidor vence o
// cupom em instante absoluto e o painel grava "até 23:59" no horário da loja.
// Formatador local (e não `hojeEmSaoPaulo` de `financeiro.ts`) para não puxar
// um módulo de 1.800 linhas do painel para dentro do checkout.
const FORMATADOR_DIA_DA_LOJA = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const UM_DIA_EM_MS = 86_400_000;

interface DiaDaLoja {
  readonly ano: string;
  readonly mes: string;
  readonly dia: string;
}

function diaDaLoja(instante: Date): DiaDaLoja {
  let ano = "";
  let mes = "";
  let dia = "";
  for (const parte of FORMATADOR_DIA_DA_LOJA.formatToParts(instante)) {
    if (parte.type === "year") ano = parte.value;
    else if (parte.type === "month") mes = parte.value;
    else if (parte.type === "day") dia = parte.value;
  }
  return { ano, mes, dia };
}

function mesmoDia(a: DiaDaLoja, b: DiaDaLoja): boolean {
  return a.ano === b.ano && a.mes === b.mes && a.dia === b.dia;
}

/**
 * O prazo do cupom já passou? Instante contra instante (o servidor vence o
 * cupom assim). Sem prazo, ou prazo ilegível, não venceu.
 */
export function cupomJaVenceu(
  validoAte: string | null,
  agora: Date = new Date(),
): boolean {
  if (!validoAte) return false;
  const fim = new Date(validoAte).getTime();
  return !Number.isNaN(fim) && fim < agora.getTime();
}

/**
 * "Vence hoje" / "Vence amanhã" / "Válido até 30/09" (com o ano quando não é
 * o ano corrente) — ou "Vencido" quando o prazo já passou (a tela pode ficar
 * aberta por horas: uma data velha não pode parecer validade). No calendário
 * da LOJA (America/Sao_Paulo), qualquer que seja o fuso do aparelho — o mesmo
 * do painel (`validade-do-cupom.ts`: a data escolhida vale até 23:59 do
 * horário da loja). Brasília está em UTC-3 o ano todo (sem horário de verão
 * desde 2019), então "amanhã" é +24 h.
 */
export function validadeDoCupom(
  validoAte: string | null,
  agora: Date = new Date(),
): string | null {
  if (!validoAte) return null;
  const fim = new Date(validoAte);
  if (Number.isNaN(fim.getTime())) return null;
  if (cupomJaVenceu(validoAte, agora)) return "Vencido";
  const diaFim = diaDaLoja(fim);
  const diaHoje = diaDaLoja(agora);
  if (mesmoDia(diaFim, diaHoje)) return "Vence hoje";
  if (mesmoDia(diaFim, diaDaLoja(new Date(agora.getTime() + UM_DIA_EM_MS)))) {
    return "Vence amanhã";
  }
  return diaFim.ano === diaHoje.ano
    ? `Válido até ${diaFim.dia}/${diaFim.mes}`
    : `Válido até ${diaFim.dia}/${diaFim.mes}/${diaFim.ano}`;
}

/**
 * O código do cupom que ECONOMIZA MAIS no carrinho de agora — só entre os que
 * já valem; empate fica com o primeiro da lista (o servidor já ordena por
 * desconto e, no empate, pelo que vence antes). `null` quando nenhum vale ou
 * quando há um cupom só (destacar "o melhor" de um não diz nada).
 */
export function melhorCupom(cupons: readonly CupomDisponivel[]): string | null {
  if (cupons.length < 2) return null;
  let melhor: CupomDisponivel | null = null;
  for (const c of cupons) {
    if (!c.aplica || c.desconto <= 0) continue;
    if (!melhor || c.desconto > melhor.desconto) melhor = c;
  }
  return melhor?.codigo ?? null;
}

/** Quanto do mínimo o carrinho já cobre, de 0 a 100 (barra do "faltam"). */
export function progressoAteOMinimo(
  cupom: Pick<CupomDisponivel, "minimo" | "falta">,
): number {
  if (cupom.minimo <= 0) return 100;
  const feito = (cupom.minimo - cupom.falta) / cupom.minimo;
  return Math.min(Math.max(Math.round(feito * 100), 0), 100);
}
