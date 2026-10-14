/**
 * Link de WhatsApp do cliente do pedido — ou `null` quando o número não
 * abre conversa nenhuma (laudo 0109, A-7).
 *
 * Regra: menos de 10 dígitos é número sem DDD+numero — `wa.me` abre janela
 * morta ou conversa com número inválido, então quem decide NÃO mostrar o
 * botão recebe `null`. 10 ou 11 dígitos (DDD + numero) recebem o prefixo 55
 * do Brasil, como os pontos já faziam. 12+ dígitos já chegam com código de
 * país — passam como estão.
 */
export function linkWhatsappDoCliente(
  telefone: string | null | undefined,
): string | null {
  const digitos = (telefone || "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  if (digitos.length <= 11) return `https://wa.me/55${digitos}`;
  return `https://wa.me/${digitos}`;
}
