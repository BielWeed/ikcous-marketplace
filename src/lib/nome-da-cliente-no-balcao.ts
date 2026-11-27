// O literal que o banco grava em `customer_name` quando a venda de balcão
// nasce sem nome: sem cliente, ou com cliente cadastrada cujo perfil não tem
// nome (migration do balcão, o COALESCE final do passo 6). Não é nome de
// gente. Uma fonte só para o recibo, o papel, o WhatsApp e o CRM.
export const NOME_DE_VENDA_SEM_CLIENTE = "Venda no balcão";

interface PedidoComCliente {
  readonly canal?: string | null;
  readonly userId?: string | null;
  readonly customer?: {
    readonly name?: string | null;
    readonly whatsapp?: string | null;
  } | null;
}

/**
 * O nome da cliente como o papel e as mensagens o mostram. Na venda de balcão
 * gravada com o literal acima: com conta, "Cliente"; avulso com WhatsApp, o
 * nome que foi digitado; sem conta nem WhatsApp, vazio. Fora disso, o nome
 * gravado, sem mexer.
 */
export function nomeDaClienteNoPedido(pedido: PedidoComCliente): string {
  const nome = pedido.customer?.name ?? "";
  if (
    pedido.canal !== "presencial" ||
    nome.trim() !== NOME_DE_VENDA_SEM_CLIENTE
  ) {
    return nome;
  }
  if (pedido.userId) return "Cliente";
  return pedido.customer?.whatsapp?.trim() ? nome : "";
}
