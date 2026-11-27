// Programação de datas do banner (início e fim da exibição).
//
// Funções puras, usadas pelo painel (AdminBannersView) para não deixar a
// lojista salvar datas sem sentido e para mostrar, em palavras, quando o
// banner termina.
//
// 27/11/2026: todas as horas são as de BRASÍLIA, nunca as do aparelho. Antes o
// campo era lido no fuso do computador da lojista: num aparelho em UTC, o
// banner marcado para 28/11 00:00 entrava às 21:00 do dia 27 em Brasília, e a
// tela devolvia o mesmo "28/11 00:00" que ela digitou. Mesma régua fixa
// UTC-03:00 da validade do cupom (`validade-do-cupom.ts`, que explica por que
// fixa e não `Intl`): Brasília não tem horário de verão desde 2019.

import { DESLOCAMENTO_DA_LOJA_EM_MS } from "@/utils/validade-do-cupom";

export const MENSAGEM_FIM_ANTES_DO_INICIO =
  "O fim precisa ser depois do início. Ajuste as datas para poder salvar.";

export type ProblemaDasDatas = "fim-antes-do-inicio" | "fim-ja-passou" | null;

function dataValida(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * O que está errado nas datas que a lojista escolheu:
 *  - `fim-antes-do-inicio`: o fim não vem DEPOIS do início — bloqueia o salvar;
 *  - `fim-ja-passou`: o fim já passou, o banner nunca vai aparecer — pede
 *    confirmação;
 *  - `null`: nada de estranho (ou datas vazias/ilegíveis).
 */
export function problemaDasDatas(
  inicioIso: string | null | undefined,
  fimIso: string | null | undefined,
  agora: Date = new Date(),
): ProblemaDasDatas {
  const fim = dataValida(fimIso);
  if (!fim) return null;
  const inicio = dataValida(inicioIso);
  if (inicio && fim.getTime() <= inicio.getTime()) return "fim-antes-do-inicio";
  if (fim.getTime() < agora.getTime()) return "fim-ja-passou";
  return null;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/**
 * O instante como o relógio de parede de Brasília o mostra: lido com os
 * getters `getUTC*`, dá o dia e a hora da loja em qualquer aparelho.
 */
function naLoja(instante: Date): Date {
  return new Date(instante.getTime() - DESLOCAMENTO_DA_LOJA_EM_MS);
}

/** O instante real de um dia e hora do relógio de Brasília (mês de 0 a 11). */
function daLoja(
  ano: number,
  mes: number,
  dia: number,
  hora = 0,
  minuto = 0,
  segundo = 0,
): Date {
  return new Date(
    Date.UTC(ano, mes, dia, hora, minuto, segundo) + DESLOCAMENTO_DA_LOJA_EM_MS,
  );
}

function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * O valor do campo `datetime-local` ("aaaa-mm-ddThh:mm") lido como horário de
 * Brasília, no instante ISO que vai ao banco. Vazio ou impossível (30/02, mês
 * 13, 24:00) devolve null: o `Date.UTC` "rola" componente fora de faixa, então
 * o dia construído é conferido contra o digitado.
 */
export function instanteDoCampoDoBanner(valor: string): string | null {
  // Os segundos são opcionais: o campo só os manda com `step` menor que 60.
  const partes = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(:\d\d)?$/.exec(valor);
  if (!partes) return null;
  const [ano, mes, dia, hora, minuto] = partes.slice(1, 6).map(Number);
  const segundo = partes[6] ? Number(partes[6].slice(1)) : 0;
  const instante = daLoja(ano, mes - 1, dia, hora, minuto, segundo);
  const conferido = naLoja(instante);
  if (
    Number.isNaN(instante.getTime()) ||
    conferido.getUTCFullYear() !== ano ||
    conferido.getUTCMonth() !== mes - 1 ||
    conferido.getUTCDate() !== dia ||
    conferido.getUTCHours() !== hora ||
    conferido.getUTCMinutes() !== minuto
  ) {
    return null;
  }
  return instante.toISOString();
}

/**
 * O instante gravado no valor que o campo `datetime-local` exibe, no horário
 * de Brasília. Vazio ou ilegível devolve "".
 */
export function campoDoBannerDoInstante(iso?: string | null): string {
  const instante = dataValida(iso);
  if (!instante) return "";
  return naLoja(instante).toISOString().slice(0, 16);
}

export type AtalhoDoPeriodo = "24h" | "weekend" | "7d" | "30d";

/**
 * O período dos atalhos de "Programar datas". Os de duração são agora + N x
 * 24 h; o "Fim de Semana" vai do sábado 00:00 ao domingo 23:59:59 do
 * calendário de Brasília (já no sábado ou no domingo, começa agora).
 */
export function periodoDoAtalhoDoBanner(
  atalho: AtalhoDoPeriodo,
  agora: Date = new Date(),
): { inicio: Date; fim: Date } {
  const DIA = 24 * 60 * 60 * 1000;
  const inicio = new Date(agora.getTime());
  if (atalho !== "weekend") {
    const dias = atalho === "24h" ? 1 : atalho === "7d" ? 7 : 30;
    return { inicio, fim: new Date(agora.getTime() + dias * DIA) };
  }
  const hoje = naLoja(agora);
  const ano = hoje.getUTCFullYear();
  const mes = hoje.getUTCMonth();
  const dia = hoje.getUTCDate();
  const diaDaSemana = hoje.getUTCDay();
  const ateSabado = (6 - diaDaSemana + 7) % 7;
  const jaEFimDeSemana = diaDaSemana === 6 || diaDaSemana === 0;
  const ateDomingo = diaDaSemana === 0 ? 0 : ateSabado + 1;
  return {
    inicio: jaEFimDeSemana ? inicio : daLoja(ano, mes, dia + ateSabado),
    fim: daLoja(ano, mes, dia + ateDomingo, 23, 59, 59),
  };
}

/**
 * O fim da programação em palavras ("Termina amanhã às 14:30."). Vazio quando
 * não há fim legível.
 */
export function fimDoBannerEmTexto(
  fimIso: string | null | undefined,
  agora: Date = new Date(),
): string {
  const instante = dataValida(fimIso);
  if (!instante) return "";
  // Dia e hora de Brasília, em qualquer aparelho.
  const fim = naLoja(instante);
  const hoje = naLoja(agora);
  const hora = `${doisDigitos(fim.getUTCHours())}:${doisDigitos(fim.getUTCMinutes())}`;
  const diaMes = `${doisDigitos(fim.getUTCDate())}/${doisDigitos(fim.getUTCMonth() + 1)}`;
  const dia =
    fim.getUTCFullYear() === hoje.getUTCFullYear()
      ? diaMes
      : `${diaMes}/${fim.getUTCFullYear()}`;

  if (instante.getTime() < agora.getTime()) {
    return `Já terminou em ${dia} às ${hora}.`;
  }
  if (mesmoDia(fim, hoje)) return `Termina hoje às ${hora}.`;
  const amanha = new Date(
    Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + 1),
  );
  if (mesmoDia(fim, amanha)) return `Termina amanhã às ${hora}.`;
  return `Termina em ${dia} às ${hora}.`;
}

/**
 * O banner está NO AR agora: ligado e dentro da programação (já começou e
 * ainda não terminou). A mesma regra do filtro "Ativos" do painel — ligado
 * fora da janela de datas não aparece na vitrine.
 */
export function estaNoAr(
  banner: {
    active: boolean;
    startDate?: string | null;
    endDate?: string | null;
  },
  agora: Date = new Date(),
): boolean {
  return (
    banner.active &&
    (!banner.startDate || new Date(banner.startDate) <= agora) &&
    (!banner.endDate || new Date(banner.endDate) >= agora)
  );
}
