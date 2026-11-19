import {
  dddBrasileiroValido,
  limparTelefoneBrasileiro,
} from "@/lib/telefone-br";

/**
 * Link de WhatsApp do cliente do pedido — ou `null` quando o número não
 * abre conversa nenhuma (laudo 0109, A-7).
 *
 * Regra: menos de 10 dígitos é número sem DDD+numero — `wa.me` abre janela
 * morta ou conversa com número inválido, então quem decide NÃO mostrar o
 * botão recebe `null`. 10 ou 11 dígitos (DDD + numero) recebem o prefixo 55
 * do Brasil, como os pontos já faziam. 12+ dígitos já chegam com código de
 * país — passam como estão.
 *
 * Cadastro antigo guarda o zero de tronco ("034 99999-1234"), a operadora
 * ("014 34 …") ou o "0055": o número é normalizado por `limparTelefoneBrasileiro`
 * (a mesma regra das máscaras) antes de contar dígitos e prefixar o 55 — assim
 * o link nunca sai com o zero na frente nem com o 55 duplicado.
 */
export function linkWhatsappDoCliente(
  telefone: string | null | undefined,
): string | null {
  const digitos = limparTelefoneBrasileiro(telefone);
  if (digitos.length < 10) return null;
  if (digitos.length <= 11) return `https://wa.me/55${digitos}`;
  return `https://wa.me/${digitos}`;
}

/**
 * No caixa, só um telefone brasileiro completo pode receber o recibo.
 * O campo avulso já entrega dígitos nacionais: nunca releia o DDD 55 como DDI.
 */
export function linkWhatsappDoClienteDoBalcao(
  telefone: string | null | undefined,
  { jaNacional = false }: { jaNacional?: boolean } = {},
): string | null {
  const texto = telefone?.trimStart();
  if (texto?.startsWith("+") && !texto.startsWith("+55")) return null;

  const nacional = jaNacional
    ? (telefone ?? "")
    : limparTelefoneBrasileiro(texto);
  if (!/^\d{10,11}$/.test(nacional) || !dddBrasileiroValido(nacional))
    return null;
  const completo =
    (nacional.length === 10 && /^[2-5]$/.test(nacional.charAt(2))) ||
    (nacional.length === 11 && nacional[2] === "9");
  return completo ? `https://wa.me/55${nacional}` : null;
}
