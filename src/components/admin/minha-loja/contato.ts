// Regras do número de WhatsApp da loja (Minha loja › Contato), extraídas da
// antiga tela "Atendimento" (painel simples, D9) sem mudar o comportamento:
// o campo é OPCIONAL (decisão de 30/08 — vazio grava NULL e o botão de
// WhatsApp some da loja); preenchido, vale DDD + número (10 ou 11 dígitos) e o
// +55 do Brasil entra sozinho na hora de gravar.

/** Só os dígitos do que foi digitado ou salvo. */
export function soDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

/**
 * O número como o campo mostra: sem o +55 (ele é desenhado ao lado do campo).
 * Só tira o 55 de número COM país (12 ou 13 dígitos) — um DDD 55 (interior do
 * RS) sem país não pode perder os dois primeiros dígitos.
 */
export function numeroParaOCampo(valor: string | null | undefined): string {
  const digitos = soDigitos(valor);
  return digitos.startsWith("55") &&
    (digitos.length === 12 || digitos.length === 13)
    ? digitos.slice(2)
    : digitos;
}

/** A forma gravada: 10 ou 11 dígitos ganham o 55; o resto fica como está. */
export function numeroComPais(valor: string | null | undefined): string {
  const digitos = soDigitos(valor);
  return digitos.length === 10 || digitos.length === 11
    ? `55${digitos}`
    : digitos;
}

export type WhatsappParaGravar =
  | { readonly valido: true; readonly valor: string | null }
  | { readonly valido: false };

/** O que digitaram → o que vai ao banco (`null` = vazio, ausência honesta). */
export function whatsappParaGravar(
  digitado: string | null | undefined,
): WhatsappParaGravar {
  const digitos = soDigitos(digitado);
  if (digitos.length > 0 && digitos.length < 10) return { valido: false };
  return { valido: true, valor: numeroComPais(digitos) || null };
}
