import {
  rotuloDoPagamento,
  rotuloDoStatus,
} from "@/components/admin/orders/OrderStatusBadge";
import {
  type FormaDoPedido,
  rotuloDaFormaDoPedido,
} from "@/lib/forma-de-pagamento";
import {
  type TipoDeEntregaDoPedido,
  tipoDeEntregaDoPedido,
} from "@/lib/tipo-de-entrega-do-pedido";
import type { Order as Pedido } from "@/types";

/** A forma do pedido na lista e na planilha — o MESMO rótulo para as duas
 * (`rotuloDaFormaDoPedido`, achado D4 de 28/09). Recebe o pedido, e não só o
 * `paymentMethod`, porque "cartão" quer dizer coisa diferente no site e no
 * balcão. */
export function rotuloDaFormaDePagamento(pedido: FormaDoPedido): string {
  return rotuloDaFormaDoPedido(pedido);
}

// "Canal" e "Entrega" entram NO FIM, nunca no meio: quem já tem planilha
// salva com fórmula por posição de coluna perde tudo se as colunas antigas
// andarem de lugar (lote C4, item 15).
const CABECALHO =
  "Número do pedido;Data;Cliente;Telefone;Status;Forma de pagamento;Status do pagamento;Total;Cidade;UF;Itens;Subtotal;Frete;Desconto;Canal;Entrega";

// Mesma classificação da ficha do pedido (`tipoDeEntregaDoPedido`), em
// português para quem abre a planilha. Balcão repete "Balcão": a venda
// presencial não tem entrega, e célula vazia pareceria dado perdido.
const ROTULO_DA_ENTREGA: Record<TipoDeEntregaDoPedido, string> = {
  balcao: "Balcão",
  retirada: "Retirada na loja",
  "entrega-local": "Entrega própria",
  envio: "Envio",
};

function escaparCampo(valor: string): string {
  // Aspas CSV não impedem fórmulas: texto vindo do cliente precisa continuar texto.
  const seguro =
    /^[\t\r\n]/.test(valor) || /^[\s]*[=+@-]/.test(valor) ? `'${valor}` : valor;
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
}

const FORMATADOR_DATA_DA_LOJA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function dataLocal(valor: string): string {
  const data = new Date(valor);
  // Data ilegível não derruba a planilha inteira: a coluna sai vazia.
  if (Number.isNaN(data.getTime())) return "";
  const partes = FORMATADOR_DATA_DA_LOJA.formatToParts(data);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")}/${parte("month")}/${parte("year")} ${parte("hour")}:${parte("minute")}`;
}

/** Exporta somente os pedidos recebidos, na mesma ordem, sem alterar a lista.
 * `rotulos` (variantId -> "Tamanho M") é o que o pedido NÃO grava: o nome do
 * item é só o do produto, e quem separa a mercadoria pela planilha precisa do
 * tamanho e da cor. Item sem rótulo no mapa sai como sempre saiu. */
export function pedidosParaCsv(
  pedidos: Pedido[],
  rotulos: Readonly<Record<string, string>> = {},
): string {
  const linhas = pedidos.map((pedido) =>
    [
      escaparCampo(`#${pedido.id.slice(-6).toUpperCase()}`),
      dataLocal(pedido.createdAt),
      escaparCampo(pedido.customer?.name || "Cliente"),
      escaparCampo(pedido.customer?.whatsapp ?? ""),
      // Mesmo rótulo das telas: retirada na loja pronta é "Pronto para
      // retirar", não "Em Trânsito" (achado b13).
      escaparCampo(rotuloDoStatus(pedido.status, pedido.retiradaNaLoja)),
      escaparCampo(rotuloDaFormaDePagamento(pedido)),
      escaparCampo(
        rotuloDoPagamento(pedido.paymentStatus, pedido.status, pedido.canal),
      ),
      pedido.total.toFixed(2).replace(".", ","),
      escaparCampo(pedido.customer?.city ?? ""),
      escaparCampo(pedido.customer?.state ?? ""),
      escaparCampo(
        pedido.items
          .map((item) => {
            const rotulo = item.variantId ? rotulos[item.variantId] : "";
            return `${item.name}${rotulo ? ` - ${rotulo}` : ""} (${item.quantity} x ${item.price.toFixed(2).replace(".", ",")})`;
          })
          .join(" | "),
      ),
      pedido.subtotal.toFixed(2).replace(".", ","),
      pedido.shipping.toFixed(2).replace(".", ","),
      pedido.discount.toFixed(2).replace(".", ","),
      // Rótulo em português para humano — quem abre o CSV é o lojista, não
      // um parser. "Site" (não "Online") porque é a palavra que o resto do
      // painel usa para o mesmo canal (OrderDetail.tsx, "Pago no site").
      escaparCampo(pedido.canal === "presencial" ? "Balcão" : "Site"),
      escaparCampo(ROTULO_DA_ENTREGA[tipoDeEntregaDoPedido(pedido)]),
    ].join(";"),
  );
  return `\uFEFF${[CABECALHO, ...linhas].join("\r\n")}`;
}
