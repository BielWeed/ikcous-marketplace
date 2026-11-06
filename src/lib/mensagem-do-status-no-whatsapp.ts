import {
  linkDeRastreio,
  normalizarCodigoDeRastreio,
} from "@/lib/link-de-rastreio";
import {
  ROTULOS_DAS_ETAPAS,
  ROTULO_RETIRADA_PRONTA,
} from "@/lib/rotulos-das-etapas";

/**
 * O nome da etapa como a CLIENTE lê no app, para o que a lojista manda a ela
 * (aviso push e WhatsApp). O rótulo do painel ("Em Trânsito", "Finalizado",
 * "Novo Pedido") é da lojista e fica no toast dela. Status que o type não
 * conhece (o histórico 'new') cai em "Recebido", nunca no valor cru do banco.
 */
export function rotuloDoStatusParaACliente(
  status: string,
  retiradaNaLoja?: boolean | null,
): string {
  switch (status) {
    case "processing":
      return ROTULOS_DAS_ETAPAS.separado;
    case "shipping":
      return retiradaNaLoja
        ? ROTULO_RETIRADA_PRONTA
        : ROTULOS_DAS_ETAPAS.aCaminho;
    case "delivered":
      // Na retirada ninguém "entrega" nada: o app da cliente diz "Retirado".
      return retiradaNaLoja ? "Retirado" : ROTULOS_DAS_ETAPAS.entregue;
    case "cancelled":
      return "Cancelado";
    default:
      return ROTULOS_DAS_ETAPAS.recebido;
  }
}

interface DadosDaMensagem {
  nomeDoCliente: string;
  numeroDoPedido: string;
  /** Rótulo do status como a cliente o lê (`rotuloDoStatusParaACliente`). */
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
  // Pedido cancelado não agradece a compra: avisa e deixa a conversa aberta
  // para a lojista explicar o motivo.
  const fecho =
    status === "cancelled"
      ? "Qualquer dúvida sobre o cancelamento, é só responder esta mensagem."
      : `Obrigado por comprar na ${nomeDaLoja}!`;
  return `Olá ${nomeDoCliente}!\n\nSeu pedido #${numeroDoPedido} foi atualizado.\nStatus: ${rotuloDoStatus}\n${rastreio}\n${fecho}`;
}
