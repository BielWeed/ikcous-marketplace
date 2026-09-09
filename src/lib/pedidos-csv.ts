import {
  rotuloDoPagamento,
  statusConfig,
} from "@/components/admin/orders/OrderStatusBadge";
import type { Order as Pedido } from "@/types";

const PAYMENT_METHOD_LABELS = new Map([
  ["pix", "PIX Instantâneo"],
  ["card", "Crédito Seguro"],
  ["cash", "Dinheiro"],
]);

export function rotuloDaFormaDePagamento(method: string): string {
  return PAYMENT_METHOD_LABELS.get(method) || "Outro";
}

const statusPorChave = new Map(Object.entries(statusConfig));
const CABECALHO =
  "Número do pedido;Data;Cliente;Telefone;Status;Forma de pagamento;Status do pagamento;Total;Cidade;UF;Itens;Subtotal;Frete;Desconto";

function escaparCampo(valor: string): string {
  // Aspas CSV não impedem fórmulas: texto vindo do cliente precisa continuar texto.
  const seguro =
    /^[\t\r\n]/.test(valor) || /^[\s]*[=+@-]/.test(valor) ? `'${valor}` : valor;
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
}

function dataLocal(valor: string): string {
  const data = new Date(valor);
  const doisDigitos = (numero: number) => String(numero).padStart(2, "0");
  return `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}/${data.getFullYear()} ${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`;
}

/** Exporta somente os pedidos recebidos, na mesma ordem, sem alterar a lista. */
export function pedidosParaCsv(pedidos: Pedido[]): string {
  const linhas = pedidos.map((pedido) =>
    [
      escaparCampo(`#${pedido.id.slice(-6).toUpperCase()}`),
      dataLocal(pedido.createdAt),
      escaparCampo(pedido.customer?.name || "Cliente"),
      escaparCampo(pedido.customer?.whatsapp ?? ""),
      escaparCampo(
        (statusPorChave.get(pedido.status) ?? statusConfig.pending).label,
      ),
      escaparCampo(rotuloDaFormaDePagamento(pedido.paymentMethod)),
      escaparCampo(rotuloDoPagamento(pedido.paymentStatus, pedido.status)),
      pedido.total.toFixed(2).replace(".", ","),
      escaparCampo(pedido.customer?.city ?? ""),
      escaparCampo(pedido.customer?.state ?? ""),
      escaparCampo(
        pedido.items
          .map(
            (item) =>
              `${item.name} (${item.quantity} x ${item.price.toFixed(2).replace(".", ",")})`,
          )
          .join(" | "),
      ),
      pedido.subtotal.toFixed(2).replace(".", ","),
      pedido.shipping.toFixed(2).replace(".", ","),
      pedido.discount.toFixed(2).replace(".", ","),
    ].join(";"),
  );
  return `\uFEFF${[CABECALHO, ...linhas].join("\r\n")}`;
}
