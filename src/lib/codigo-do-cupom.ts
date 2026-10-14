/**
 * Código do cupom como o painel grava: maiúsculas, sem espaço e SEM ACENTO.
 *
 * O servidor compara o código sem ignorar acento. Se o painel gravasse
 * "VERÃO10", a cliente que digita "VERAO10" recebia "Cupom inválido ou
 * expirado". Mesma técnica de `normalizeText` (NFD + tirar os sinais).
 */
export function normalizarCodigoDoCupom(
  valor: string | null | undefined,
): string {
  return (valor || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "");
}

/**
 * Código do cupom que vai para o servidor. Se a pessoa NÃO mexeu no código de
 * um cupom que já existe, ele segue intacto: cupom antigo "VERÃO10" já
 * distribuído não pode ser renomeado em silêncio só porque a lojista abriu a
 * tela para prorrogar a validade. Só o que foi digitado é normalizado.
 */
export function codigoDoCupomParaSalvar(
  atual: string | null | undefined,
  original: string | null | undefined,
): string {
  if (original && atual === original) return original;
  return normalizarCodigoDoCupom(atual);
}
