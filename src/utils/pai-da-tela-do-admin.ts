import type { View } from "@/types";

/**
 * Para onde o botão "Voltar" do `AdminLayout` leva, a partir da tela atual
 * (`view`). Extraída de `getParentView` (antes só uma tabela fixa) para
 * ganhar uma regra sensível à ORIGEM real da navegação.
 *
 * Existem cinco caminhos até "admin-push" (sino da barra superior, botão
 * "Push" da sidebar, menu do cliente em duas variações, banner do painel) e
 * todos caíam sempre em "admin-settings", porque a tabela antiga não sabia
 * de onde a pessoa tinha vindo. O sino aparece em TODA tela do admin, então
 * esse caminho errado era o normal, não a exceção.
 *
 * Ordem de precedência:
 *   1. `ehSubViewDeDetalheDePedido` — vence tudo, igual ao comportamento de
 *      hoje: quem está vendo o detalhe de um pedido (`?id=` na URL) volta
 *      sempre para "admin-orders".
 *   2. `view === "admin-push"` com uma `origem` válida — devolve a origem.
 *      Válida significa: não nula, diferente de "admin-push" (não pode
 *      voltar para si mesma) e começando com "admin-" (veio de dentro do
 *      painel; qualquer coisa de fora cai no fallback).
 *   3. a mesma tabela fixa de sempre. Só "admin-push" ganhou o
 *      comportamento novo — "admin-banners", "admin-carousels" e
 *      "admin-whatsapp-config" continuam caindo em "admin-settings" mesmo
 *      com origem preenchida, porque elas só são alcançadas por
 *      Configurações.
 */
export function paiDaTelaDoAdmin(
  view: View,
  origem: View | null,
  ehSubViewDeDetalheDePedido: boolean,
): View | "profile" {
  if (ehSubViewDeDetalheDePedido) {
    return "admin-orders";
  }

  if (
    view === "admin-push" &&
    origem != null &&
    origem !== "admin-push" &&
    origem.startsWith("admin-")
  ) {
    return origem;
  }

  switch (view) {
    case "admin-coupon-form":
      return "admin-coupons";
    case "admin-product-form":
    case "admin-coupons":
    case "admin-shipping":
      return "admin-products";
    case "admin-user-detail":
      return "admin-customers";
    case "admin-push":
    case "admin-banners":
    case "admin-carousels":
    case "admin-whatsapp-config":
      return "admin-settings";
    case "admin-reviews":
    case "admin-qa":
      return "admin-orders";
    default:
      return "profile";
  }
}
