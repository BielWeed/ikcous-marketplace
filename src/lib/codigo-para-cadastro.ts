import {
  REGEX_CODIGO_BARRAS,
  normalizarCodigoBarras,
} from "@/lib/codigo-de-barras";

// O código que o balcão leu e não achou no catálogo, a caminho do cadastro
// de produto NOVO: quem toca em "Cadastrar produto" no aviso do balcão não
// redigita o número. É um recado de UMA passagem entre duas telas que nunca
// estão montadas ao mesmo tempo, então fica na memória da página (não vai
// para o disco: não sobrevive a recarregar nem vira "rascunho").
//
// Vale uma vez (`tomar` esvazia) e por pouco tempo: o toque que a trava de
// "alterações não salvas" segurou, ou que não chegou a abrir o cadastro, não
// pode aparecer horas depois num produto novo aberto pela lista.

/** Folga para a tela de cadastro abrir (inclui baixar o pedaço da tela e a
 * pergunta de "alterações não salvas" do balcão). */
export const VALIDADE_DO_CODIGO_PARA_CADASTRO_MS = 2 * 60 * 1000;

let recado: { readonly codigo: string; readonly em: number } | null = null;

export function guardarCodigoParaCadastro(
  codigo: string,
  agora: number = Date.now(),
): void {
  recado = { codigo, em: agora };
}

/** Joga o recado fora: o destino (formulário de produto novo) foi abandonado. */
export function descartarCodigoParaCadastro(): void {
  recado = null;
}

/**
 * O código guardado, já na limpeza do campo, ou `null` se não há, venceu ou
 * não cabe no formato do campo (então o campo fica vazio, como sempre foi).
 * Chamar esvazia o recado — vale para quem tomou, usando ou não.
 */
export function tomarCodigoParaCadastro(
  agora: number = Date.now(),
): string | null {
  const guardado = recado;
  recado = null;
  if (!guardado) return null;
  if (agora - guardado.em > VALIDADE_DO_CODIGO_PARA_CADASTRO_MS) return null;
  const codigo = normalizarCodigoBarras(guardado.codigo);
  return REGEX_CODIGO_BARRAS.test(codigo) ? codigo : null;
}
