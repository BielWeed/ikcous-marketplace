import type { View } from "@/types";

/**
 * Para onde o botão "Voltar" do `AdminLayout` leva, a partir da tela atual
 * (`view`). Extraída de `getParentView` (antes só uma tabela fixa) para
 * ganhar uma regra sensível à ORIGEM real da navegação.
 *
 * Existem quatro caminhos até "admin-push" (botão "Avisar clientes" da
 * barra lateral, menu do cliente em duas variações, banner do painel) e
 * todos caíam sempre em "admin-settings", porque a tabela antiga não sabia
 * de onde a pessoa tinha vindo.
 *
 * O sino da barra superior leva a "admin-notifications", a tela onde o
 * lojista RECEBE avisos, e não à tela que ENVIA push para clientes. Ela
 * nasceu sem entrada na tabela (caía no `default` → "profile", e o botão
 * dizia "Perfil"). Decisão do Gabriel em 30/08/2026 (prévia da cliente-01):
 * voltar para a tela do admin de ORIGEM e, sem origem do admin, cair em
 * "admin-dashboard" (painel principal) — mesmo desenho do "admin-push", com
 * fallback diferente porque ela é alcançada pelo sino de qualquer tela, não
 * por um caminho fixo.
 *
 * Ordem de precedência:
 *   1. `ehSubViewDeDetalheDePedido` — vence tudo, igual ao comportamento de
 *      hoje: quem está vendo o detalhe de um pedido (`?id=` na URL) volta
 *      sempre para "admin-orders".
 *   2. `view === "admin-push"` com uma `origem` válida — devolve a origem.
 *      Válida significa: não nula, diferente de "admin-push" (não pode
 *      voltar para si mesma) e começando com "admin-" (veio de dentro do
 *      painel; qualquer coisa de fora cai no fallback).
 *   3. `view === "admin-notifications"` com uma `origem` válida (mesma
 *      regra) — devolve a origem; sem ela, "admin-dashboard".
 *   4. `view === "admin-whatsapp-config"` com uma `origem` válida (mesma
 *      regra) — devolve a origem; sem ela, "admin-dashboard". A tela é
 *      alcançada pelo banner "Atendimento & Vendas" do painel principal E
 *      por Ajustes; voltar sempre para "admin-settings" largava quem veio
 *      pelo banner no lugar errado (achado do Gabriel com print, 30/08).
 *   5. a tabela fixa (com os casos "admin-push", "admin-notifications" e
 *      "admin-whatsapp-config" movidos para as regras acima). "admin-banners"
 *      e "admin-carousels" continuam caindo em "admin-settings": hoje só são
 *      alcançadas por Configurações.
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

  // Notificações do painel: volta para a tela do admin de onde a pessoa
  // veio (decisão do Gabriel, 30/08/2026, na prévia da cliente-01 — o botão
  // dizia "Perfil" e levava para o Perfil). Sem origem do admin conhecida
  // (recarregou a página, veio do Perfil ou de fora do painel), cai no
  // painel principal — nunca no Perfil.
  if (
    view === "admin-notifications" &&
    origem != null &&
    origem !== "admin-notifications" &&
    origem.startsWith("admin-")
  ) {
    return origem;
  }

  // Atendimento (WhatsApp da operação): mesma regra sensível à origem — a
  // tela tem DUAS portas (banner "Atendimento & Vendas" do painel principal
  // e Ajustes) e o Voltar fixo em "admin-settings" largava quem veio pelo
  // banner no lugar errado (achado do Gabriel com print, 30/08/2026). Sem
  // origem do admin conhecida, cai no painel principal.
  if (
    view === "admin-whatsapp-config" &&
    origem != null &&
    origem !== "admin-whatsapp-config" &&
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
      return "admin-settings";
    case "admin-whatsapp-config":
      return "admin-dashboard";
    case "admin-notifications":
      return "admin-dashboard";
    case "admin-reviews":
    case "admin-qa":
      return "admin-orders";
    default:
      return "profile";
  }
}
