// Programação de datas do banner (início e fim da exibição).
//
// Funções puras, usadas pelo painel (AdminBannersView) para não deixar a
// lojista salvar datas sem sentido e para mostrar, em palavras, quando o
// banner termina. Todas as horas são as do relógio LOCAL da lojista.

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

function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * O fim da programação em palavras ("Termina amanhã às 14:30."). Vazio quando
 * não há fim legível.
 */
export function fimDoBannerEmTexto(
  fimIso: string | null | undefined,
  agora: Date = new Date(),
): string {
  const fim = dataValida(fimIso);
  if (!fim) return "";
  const hora = `${doisDigitos(fim.getHours())}:${doisDigitos(fim.getMinutes())}`;
  const diaMes = `${doisDigitos(fim.getDate())}/${doisDigitos(fim.getMonth() + 1)}`;
  const dia =
    fim.getFullYear() === agora.getFullYear()
      ? diaMes
      : `${diaMes}/${fim.getFullYear()}`;

  if (fim.getTime() < agora.getTime()) {
    return `Já terminou em ${dia} às ${hora}.`;
  }
  if (mesmoDia(fim, agora)) return `Termina hoje às ${hora}.`;
  const amanha = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate() + 1,
  );
  if (mesmoDia(fim, amanha)) return `Termina amanhã às ${hora}.`;
  return `Termina em ${dia} às ${hora}.`;
}
