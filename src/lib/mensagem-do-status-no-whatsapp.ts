import {
  linkDeRastreio,
  normalizarCodigoDeRastreio,
} from "@/lib/link-de-rastreio";

interface DadosDaMensagem {
  nomeDoCliente: string;
  numeroDoPedido: string;
  /** Rótulo do status como a lojista o vê (já com "Pronto para retirar"). */
  rotuloDoStatus: string;
  nomeDaLoja: string;
  status: string;
  retiradaNaLoja?: boolean | null;
  codigoDeRastreio?: string | null;
}

/**
 * O texto que o botão de WhatsApp do painel abre para a cliente. Fica igual ao
 * de sempre em todo caso sem rastreio; quando o pedido está ENVIADO, é de
 * ENTREGA e tem código, ganha o código e o link para acompanhar. Serve a quem
 * comprou como convidada, que não tem conta, sino nem e-mail no pedido.
 */
export function mensagemDoStatusNoWhatsapp({
  nomeDoCliente,
  numeroDoPedido,
  rotuloDoStatus,
  nomeDaLoja,
  status,
  retiradaNaLoja,
  codigoDeRastreio,
}: DadosDaMensagem): string {
  const codigo = normalizarCodigoDeRastreio(codigoDeRastreio ?? "");
  const rastreio =
    status === "shipping" && !retiradaNaLoja && codigo
      ? `Código de rastreio: ${codigo}\nAcompanhe a entrega: ${linkDeRastreio(codigo)}\n`
      : "";
  return `Olá ${nomeDoCliente}!\n\nSeu pedido #${numeroDoPedido} foi atualizado.\nStatus: ${rotuloDoStatus}\n${rastreio}\nObrigado por comprar na ${nomeDaLoja}!`;
}
