/**
 * Endereço de rastreio de uma encomenda — UM lugar só, usado pelas quatro
 * telas que têm botão "Rastrear" (pedido do cliente, ficha do pedido no
 * painel, devolução do cliente e devolução no painel).
 *
 * O Melhor Rastreio cobre Correios e as transportadoras de etiqueta do Melhor
 * Envio. Se o formato do endereço mudar, é esta linha que se troca.
 * (O domínio anterior, linkrastreio.com, morreu: certificado vencido e
 * estacionado "à venda" — o cliente caía em tela de erro do navegador.)
 *
 * Tira TODOS os espaços e quebras de linha (inclusive do meio: "AA 123 456
 * 789 BR"), põe em maiúsculas e codifica para caber no caminho do endereço.
 * Devolve "" quando não sobra código — quem chama não mostra o botão.
 */
const BASE_DO_RASTREIO = "https://www.melhorrastreio.com.br/rastreio/";

export function linkDeRastreio(codigo: string): string {
  const limpo = (codigo ?? "").replace(/\s+/g, "").toUpperCase();
  if (!limpo) return "";
  return `${BASE_DO_RASTREIO}${encodeURIComponent(limpo)}`;
}
