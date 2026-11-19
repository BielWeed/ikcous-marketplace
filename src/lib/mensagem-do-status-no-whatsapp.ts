import { cortarTexto } from "@/lib/cortar-texto";
import {
  linkDeRastreioDeCodigoValido,
  normalizarCodigoDeRastreio,
} from "@/lib/link-de-rastreio";
import { nomeOuReserva } from "@/lib/nome-visivel";
import {
  ROTULOS_DAS_ETAPAS,
  ROTULO_RETIRADA_FEITA,
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
      return retiradaNaLoja
        ? ROTULO_RETIRADA_FEITA
        : ROTULOS_DAS_ETAPAS.entregue;
    case "cancelled":
      return "Cancelado";
    default:
      return ROTULOS_DAS_ETAPAS.recebido;
  }
}

interface DadosDaMensagem {
  nomeDoCliente: string | null | undefined;
  numeroDoPedido: string;
  /** Rótulo do status como a cliente o lê (`rotuloDoStatusParaACliente`). */
  rotuloDoStatus: string;
  nomeDaLoja: string;
  status: string;
  retiradaNaLoja?: boolean | null;
  codigoDeRastreio?: string | null;
  enderecoDeRetirada?: string | null;
  horarioDeAtendimento?: string | null;
}

function limitarTrechoParaWhatsapp(
  texto: string,
  max: number,
  maxCodificado: number,
): string {
  if (
    texto.length <= max &&
    encodeURIComponent(texto).length <= maxCodificado
  ) {
    return texto;
  }

  // O mesmo caractere pode ocupar mais de uma posição na URL. Reserve
  // espaço para as reticências e conte por pontos de código, sem partir pares.
  let restante = maxCodificado - encodeURIComponent("…").length;
  let unidades = 0;
  for (const caractere of texto) {
    restante -= encodeURIComponent(caractere).length;
    if (restante < 0 || unidades + caractere.length >= max) break;
    unidades += caractere.length;
  }

  // Inclui o próximo ponto de código para o helper localizar a fronteira,
  // sem precisar segmentar o texto inteiro quando ele é muito grande.
  return cortarTexto(texto.slice(0, unidades + 3), unidades + 1);
}

/**
 * O texto que o botão de WhatsApp do painel abre para a cliente. Acrescenta
 * rastreio na entrega a caminho ou orientações na retirada pronta, quando
 * disponíveis. Serve também a quem comprou como convidada.
 */
export function mensagemDoStatusNoWhatsapp({
  nomeDoCliente,
  numeroDoPedido,
  rotuloDoStatus,
  nomeDaLoja,
  status,
  retiradaNaLoja,
  codigoDeRastreio,
  enderecoDeRetirada,
  horarioDeAtendimento,
}: DadosDaMensagem): string {
  const codigo = normalizarCodigoDeRastreio(codigoDeRastreio ?? "");
  const link =
    status === "shipping" && !retiradaNaLoja
      ? linkDeRastreioDeCodigoValido(codigo)
      : "";
  const rastreio = link
    ? `Código de rastreio: ${codigo}\nAcompanhe a entrega: ${link}\n`
    : "";
  let orientacoesDeRetirada = "";
  if (retiradaNaLoja === true && status === "shipping") {
    if (enderecoDeRetirada?.trim()) {
      orientacoesDeRetirada += `Retire em: ${limitarTrechoParaWhatsapp(enderecoDeRetirada, 300, 950)}\n`;
    }
    // Nunca corte o horário: o fim pode conter um dia fechado ou uma exceção.
    const horarioCabe =
      horarioDeAtendimento?.trim() &&
      horarioDeAtendimento.length <= 200 &&
      encodeURIComponent(horarioDeAtendimento).length <= 650;
    orientacoesDeRetirada += horarioCabe
      ? `Horário: ${horarioDeAtendimento}\n`
      : "Confirme o horário de retirada com a loja antes de vir.\n";
  }
  // Pedido cancelado não agradece a compra: avisa e deixa a conversa aberta
  // para a lojista explicar o motivo.
  const fecho =
    status === "cancelled"
      ? "Qualquer dúvida sobre o cancelamento, é só responder esta mensagem."
      : `Obrigado por comprar na ${nomeDaLoja}!`;
  return `Olá ${nomeOuReserva(nomeDoCliente, "Cliente")}!\n\nSeu pedido #${numeroDoPedido} foi atualizado.\nStatus: ${rotuloDoStatus}\n${rastreio}${orientacoesDeRetirada}\n${fecho}`;
}
