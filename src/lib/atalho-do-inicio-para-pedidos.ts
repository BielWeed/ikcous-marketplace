/**
 * O recado do Início para a tela Pedidos: "esta abertura veio de um atalho,
 * abra limpa".
 *
 * Por que existe: a tela Pedidos guarda no aparelho o filtro, a busca, o
 * período, o pagamento, o canal e a página da última visita (é conveniência
 * de quem abre Pedidos pelo menu e quer continuar de onde parou). Mas o
 * atalho "Preparar pedidos" do Início promete OS PEDIDOS PARA PREPARAR — se a
 * tela abrir com o "Finalizados" ou a busca de outro dia, a lojista vê uma
 * lista vazia e acha que os pedidos sumiram.
 *
 * Por que não vai pelo `onNavigate(view, id)`: o `id` dessa rota é o do
 * pedido aberto (vira `?id=` no endereço, é refeito pela busca do pedido e
 * volta no botão "voltar"); um valor-código ali seria lido como pedido e
 * reabriria o reset a cada volta da ficha.
 *
 * Por que tem validade: a tela Pedidos fica montada atrás das outras abas e
 * lê o recado quando passa a estar à vista. Se por algum motivo ela não abrir
 * depois do atalho, o recado não pode ficar esperando e limpar, horas
 * depois, a tela de quem abriu Pedidos pelo menu — esse é exatamente o caso
 * que este recado não pode atingir.
 */

/** Tempo máximo entre o toque no atalho e a tela Pedidos ficar à vista. */
const VALIDADE_DO_PEDIDO_MS = 30_000;

let pedidoEm: number | null = null;

/** O Início chama ao tocar num atalho que leva a Pedidos. */
export function pedirPedidosSemFiltroAntigo(agora: number = Date.now()): void {
  pedidoEm = agora;
}

/**
 * A tela Pedidos chama quando passa a estar à vista. Devolve `true` no máximo
 * UMA vez por pedido do Início, e só se ele ainda estiver dentro da validade.
 */
export function consumirPedidoDePedidosSemFiltroAntigo(
  agora: number = Date.now(),
): boolean {
  const desde = pedidoEm;
  pedidoEm = null;
  return desde !== null && agora - desde <= VALIDADE_DO_PEDIDO_MS;
}
