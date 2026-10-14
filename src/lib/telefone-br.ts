/**
 * Telefone brasileiro só com dígitos, sem o código do país.
 *
 * WhatsApp colado como "+55 34 99999-1234" tem 13 dígitos; as máscaras liam
 * o "55" como DDD e cortavam os últimos. Aqui: fica só com dígitos e, se
 * sobrarem 12 ou 13 começando por 55, tira o 55. Com 10 ou 11 dígitos o "55"
 * é DDD de verdade (Rio Grande do Sul) e fica. Número estrangeiro (12+
 * dígitos sem 55 na frente) passa como está.
 */
export function limparTelefoneBrasileiro(
  valor: string | null | undefined,
): string {
  const digitos = (valor || "").replace(/\D/g, "");
  if (
    (digitos.length === 12 || digitos.length === 13) &&
    digitos.startsWith("55")
  ) {
    return digitos.slice(2);
  }
  return digitos;
}
