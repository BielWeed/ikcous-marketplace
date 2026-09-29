import { paiDaTelaDoAdmin } from "@/utils/pai-da-tela-do-admin";
import { describe, expect, it } from "vitest";

/**
 * src/utils/pai-da-tela-do-admin.ts — para onde o botão "Voltar" do
 * `AdminLayout` leva, a partir da tela atual.
 *
 * Existiam CINCO entradas para a tela "admin-push" (sino da barra superior,
 * botão "Push" da sidebar, menu do cliente em duas variações, banner do
 * painel) e todas caíam em "admin-settings" — a tabela fixa de
 * `getParentView` não sabia de onde a pessoa tinha vindo. Quem abria Push
 * pelo sino (o caminho mais comum, porque o sino aparece em toda tela do
 * admin) apertava Voltar e caía em Configurações, longe de onde estava.
 *
 * Esta função recebe a ORIGEM (a view anterior, guardada em ESTADO —
 * `origemDaView`, um `useState` no `AdminLayout`, porque a regra
 * react-hooks/refs proíbe ler ref em render) e, para as telas com
 * comportamento sensível à origem — hoje "admin-push" e
 * "admin-notifications" — devolve a origem em vez da tabela fixa, desde que
 * a origem seja uma tela do admin diferente da própria tela. Sem origem do
 * admin, "admin-push" cai em "admin-settings" e "admin-notifications" em
 * "admin-dashboard" (decisão do Gabriel, 30/08/2026: o botão da tela de
 * notificações dizia "Perfil" e levava ao Perfil). As outras entradas da
 * tabela ("admin-banners", "admin-carousels", "admin-whatsapp-config")
 * continuam batendo sempre em "admin-settings": elas só são alcançadas por
 * Configurações, então mudar isso não resolve bug nenhum e está fora do
 * escopo desta correção.
 */
describe("paiDaTelaDoAdmin", () => {
  it("admin-push com origem admin-customers volta para admin-customers", () => {
    expect(paiDaTelaDoAdmin("admin-push", "admin-customers", false)).toBe(
      "admin-customers",
    );
  });

  it("admin-push com origem admin-orders volta para admin-orders", () => {
    expect(paiDaTelaDoAdmin("admin-push", "admin-orders", false)).toBe(
      "admin-orders",
    );
  });

  it("admin-push com origem admin-dashboard volta para admin-dashboard", () => {
    expect(paiDaTelaDoAdmin("admin-push", "admin-dashboard", false)).toBe(
      "admin-dashboard",
    );
  });

  it("admin-push com origem null cai no fallback admin-settings", () => {
    expect(paiDaTelaDoAdmin("admin-push", null, false)).toBe("admin-settings");
  });

  it("admin-push com origem admin-push nunca volta para si mesma — cai em admin-settings", () => {
    expect(paiDaTelaDoAdmin("admin-push", "admin-push", false)).toBe(
      "admin-settings",
    );
  });

  it('admin-push com origem de FORA do admin ("home") cai em admin-settings', () => {
    expect(paiDaTelaDoAdmin("admin-push", "home", false)).toBe(
      "admin-settings",
    );
  });

  it("admin-banners com origem admin-customers NÃO herda o comportamento novo — continua admin-settings", () => {
    expect(paiDaTelaDoAdmin("admin-banners", "admin-customers", false)).toBe(
      "admin-settings",
    );
  });

  it("admin-carousels com origem admin-orders continua admin-settings", () => {
    expect(paiDaTelaDoAdmin("admin-carousels", "admin-orders", false)).toBe(
      "admin-settings",
    );
  });

  it("admin-whatsapp-config com origem admin-orders volta para admin-orders (origem manda)", () => {
    expect(
      paiDaTelaDoAdmin("admin-whatsapp-config", "admin-orders", false),
    ).toBe("admin-orders");
  });

  it("admin-whatsapp-config com origem admin-dashboard volta para admin-dashboard (banner 'Atendimento & Vendas')", () => {
    // Achado do Gabriel (30/08, print na mão): ele entrou no Atendimento pelo
    // banner do painel principal, apertou Voltar e caiu em Ajustes — a tabela
    // antiga não sabia que o banner existe.
    expect(
      paiDaTelaDoAdmin("admin-whatsapp-config", "admin-dashboard", false),
    ).toBe("admin-dashboard");
  });

  it("admin-whatsapp-config com origem admin-settings volta para admin-settings", () => {
    expect(
      paiDaTelaDoAdmin("admin-whatsapp-config", "admin-settings", false),
    ).toBe("admin-settings");
  });

  it("admin-whatsapp-config com origem null cai no fallback admin-dashboard", () => {
    expect(paiDaTelaDoAdmin("admin-whatsapp-config", null, false)).toBe(
      "admin-dashboard",
    );
  });

  it("admin-whatsapp-config com origem de FORA do admin (home) cai em admin-dashboard", () => {
    expect(paiDaTelaDoAdmin("admin-whatsapp-config", "home", false)).toBe(
      "admin-dashboard",
    );
  });

  it("admin-whatsapp-config com origem ela mesma nunca volta para si mesma — cai em admin-dashboard", () => {
    expect(
      paiDaTelaDoAdmin("admin-whatsapp-config", "admin-whatsapp-config", false),
    ).toBe("admin-dashboard");
  });

  it("a tabela antiga continua de pé para as demais views", () => {
    expect(paiDaTelaDoAdmin("admin-coupon-form", null, false)).toBe(
      "admin-coupons",
    );
    expect(paiDaTelaDoAdmin("admin-product-form", null, false)).toBe(
      "admin-products",
    );
    expect(paiDaTelaDoAdmin("admin-user-detail", null, false)).toBe(
      "admin-customers",
    );
    expect(paiDaTelaDoAdmin("admin-qa", null, false)).toBe("admin-orders");
    expect(paiDaTelaDoAdmin("home" as never, null, false)).toBe("profile");
  });

  // C3.3 (plano §5.3): "Vender" é sub-view do painel PRINCIPAL, não uma
  // sensível à origem como admin-push/admin-notifications/admin-whatsapp-
  // config — sem este `case` o `default` devolveria "profile" e o botão
  // Voltar do AdminLayout sairia do painel inteiro (nova-tela.md:45).
  it("admin-pdv sempre volta para admin-dashboard, com ou sem origem do admin conhecida", () => {
    expect(paiDaTelaDoAdmin("admin-pdv", null, false)).toBe("admin-dashboard");
    expect(paiDaTelaDoAdmin("admin-pdv", "home", false)).toBe(
      "admin-dashboard",
    );
    expect(paiDaTelaDoAdmin("admin-pdv", "admin-orders", false)).toBe(
      "admin-dashboard",
    );
  });

  // 26/09: Dashboard CRM e Financeiro abrem pelos botões do Início e voltam a
  // ele; Devoluções mora ao lado dos pedidos (nasce de pedido entregue).
  it("admin-crm e admin-financeiro voltam ao Início; admin-devolucoes volta aos pedidos", () => {
    expect(paiDaTelaDoAdmin("admin-crm", null, false)).toBe("admin-dashboard");
    expect(paiDaTelaDoAdmin("admin-financeiro", "home", false)).toBe(
      "admin-dashboard",
    );
    expect(paiDaTelaDoAdmin("admin-devolucoes", null, false)).toBe(
      "admin-orders",
    );
    expect(paiDaTelaDoAdmin("admin-devolucoes", "admin-dashboard", false)).toBe(
      "admin-orders",
    );
  });

  it("admin-shipping-national sempre volta para admin-shipping — tela filha do botão 'Estratégias do frete nacional'", () => {
    expect(paiDaTelaDoAdmin("admin-shipping-national", null, false)).toBe(
      "admin-shipping",
    );
    expect(
      paiDaTelaDoAdmin("admin-shipping-national", "admin-dashboard", false),
    ).toBe("admin-shipping");
  });

  it("admin-notifications com origem admin-orders volta para admin-orders (a tela anterior real)", () => {
    // Decisão do Gabriel (30/08/2026), na prévia da cliente-01: o botão que
    // dizia "Perfil" na tela de notificações do painel estava errado — o
    // esperado é VOLTAR para a tela do admin de onde a pessoa veio. O teste
    // antigo prendia o comportamento velho ("tela de topo", pai "profile")
    // e foi reescrito junto com a decisão.
    expect(paiDaTelaDoAdmin("admin-notifications", "admin-orders", false)).toBe(
      "admin-orders",
    );
  });

  it("admin-notifications com origem admin-dashboard volta para admin-dashboard", () => {
    expect(
      paiDaTelaDoAdmin("admin-notifications", "admin-dashboard", false),
    ).toBe("admin-dashboard");
  });

  it("admin-notifications com origem null cai no fallback admin-dashboard", () => {
    // Recarregar a página direto na tela de notificações não tem origem.
    expect(paiDaTelaDoAdmin("admin-notifications", null, false)).toBe(
      "admin-dashboard",
    );
  });

  it("admin-notifications com origem de FORA do admin (profile, home) cai em admin-dashboard", () => {
    expect(paiDaTelaDoAdmin("admin-notifications", "profile", false)).toBe(
      "admin-dashboard",
    );
    expect(paiDaTelaDoAdmin("admin-notifications", "home", false)).toBe(
      "admin-dashboard",
    );
  });

  it("admin-notifications com origem ela mesma nunca volta para si mesma — cai em admin-dashboard", () => {
    expect(
      paiDaTelaDoAdmin("admin-notifications", "admin-notifications", false),
    ).toBe("admin-dashboard");
  });

  it("PRECEDÊNCIA: sub-view de detalhe de pedido vence tudo, mesmo com view admin-push e origem admin-customers", () => {
    expect(paiDaTelaDoAdmin("admin-push", "admin-customers", true)).toBe(
      "admin-orders",
    );
  });
});
