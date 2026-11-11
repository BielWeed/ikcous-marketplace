import { caractereSemDesenho } from "@/lib/nome-visivel";

/**
 * Código do cupom como o painel grava: maiúsculas, sem espaço e SEM ACENTO.
 *
 * O servidor compara o código sem ignorar acento. Se o painel gravasse
 * "VERÃO10", a cliente que digita "VERAO10" recebia "Cupom inválido ou
 * expirado". Mesma técnica de `normalizeText` (NFD + tirar os sinais).
 *
 * Também tira o caractere invisível (U+200B, U+200E, U+FEFF...) que vem de
 * texto colado do WhatsApp/Word: o `\s` não o pega, o cupom era gravado com
 * ele e ninguém conseguia digitar o código. Mesma definição de "invisível"
 * do `nome-visivel` (o checkout já a usa).
 */
export function normalizarCodigoDoCupom(
  valor: string | null | undefined,
): string {
  return Array.from(valor || "")
    .filter((caractere) => !caractereSemDesenho(caractere))
    .join("")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "");
}

/**
 * A recusa do servidor foi "este código não existe"? É a frase de
 * `validate_coupon_secure_v2` para código desconhecido, cupom desligado e
 * exclusivo de outra conta (as três respondem igual de propósito). Só ela
 * justifica tentar o código por outra grafia: "expirou", "limite de uso" e
 * "faltam R$" provam que o cupom EXISTE e que a grafia estava certa.
 */
export function ehRecusaDeCupomInexistente(
  mensagem: string | null | undefined,
): boolean {
  return /^cupom inv[aá]lido ou expirado\.?$/i.test((mensagem ?? "").trim());
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
