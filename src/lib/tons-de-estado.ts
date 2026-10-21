// Cores que SIGNIFICAM algo, em dose mínima: verde = positivo (entrou, pago,
// ativo), vermelho = negativo (saiu, atrasado, erro), âmbar = atenção
// (pendente, precisa de ação), azul = informação, cinza = inativo/sem dado.
// Laranja foi unificado em âmbar. Forma: ponto + texto/número/ícone na cor,
// nunca bloco inteiro pintado; a cor nunca é a única pista (sempre há texto).
// Classes literais (o Tailwind só gera o que lê por inteiro) e contraste AA.

export type TomDeEstado =
  | "positivo"
  | "negativo"
  | "atencao"
  | "info"
  | "neutro";
/** painel = fundo escuro #0B0B0D; loja = fundo claro #FFFFFF. */
export type Superficie = "painel" | "loja";

export function tomDoValor(
  valor: number | null | undefined,
  opcoes?: { invertido?: boolean },
): TomDeEstado {
  if (valor == null || Number.isNaN(valor) || valor === 0) return "neutro";
  const positivo = valor > 0 !== !!opcoes?.invertido;
  return positivo ? "positivo" : "negativo";
}

const TEXTO: Record<Superficie, Record<TomDeEstado, string>> = {
  painel: {
    positivo: "text-emerald-400",
    negativo: "text-red-400",
    atencao: "text-amber-400",
    info: "text-sky-400",
    neutro: "text-zinc-400",
  },
  loja: {
    positivo: "text-emerald-700",
    negativo: "text-red-700",
    atencao: "text-amber-700",
    info: "text-sky-700",
    neutro: "text-zinc-600",
  },
};

const PONTO: Record<Superficie, Record<TomDeEstado, string>> = {
  painel: {
    positivo: "bg-emerald-400",
    negativo: "bg-red-400",
    atencao: "bg-amber-400",
    info: "bg-sky-400",
    neutro: "bg-zinc-400",
  },
  loja: {
    positivo: "bg-emerald-600",
    negativo: "bg-red-600",
    atencao: "bg-amber-600",
    info: "bg-sky-600",
    neutro: "bg-zinc-600",
  },
};

export const classeDoTexto = (tom: TomDeEstado, s: Superficie = "painel") =>
  // eslint-disable-next-line security/detect-object-injection -- chaves tipadas
  TEXTO[s][tom];
export const classeDoPonto = (tom: TomDeEstado, s: Superficie = "painel") =>
  // eslint-disable-next-line security/detect-object-injection -- chaves tipadas
  PONTO[s][tom];
export const classeDoIcone = classeDoTexto;
