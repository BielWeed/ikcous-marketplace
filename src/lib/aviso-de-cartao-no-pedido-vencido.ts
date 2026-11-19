export function avisoDeCartaoNoPedidoVencido(
  metodoOnline: string | null | undefined,
): string | undefined {
  // A análise do cartão pode passar do fim da reserva.
  if (metodoOnline === "credito" || metodoOnline === "debito") {
    return "O prazo do pagamento terminou e o pedido foi cancelado. Antes de comprar de novo, fale com a loja para confirmar se o pagamento do cartão foi aprovado.";
  }
}
