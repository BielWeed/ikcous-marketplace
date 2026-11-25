// Caça de provas fracas (24/11/2026), papéis: a lista FECHADA de telas do
// painel que atravessam o login (`VIEWS_REDIRECIONAVEIS`) tinha duas pontas
// soltas no teste vizinho (`destino-pos-login-painel`):
//   - `admin-financeiro` está na lista (a lojista que perde a sessão no
//     Financeiro volta a ele) e nenhum teste a exigia: tirar a tela da lista
//     jogava a lojista no Perfil de cliente sem nada reprovar;
//   - o teste da lista fechada citava só 5 telas do painel de fora. Acrescentar
//     OUTRA tela do painel à lista (clientes, cupons, devolução...) passava em
//     silêncio. Aqui cada tela `admin*` do roteador (`App.tsx`) que NÃO é uma
//     das cinco aceitas precisa cair no perfil.
// A permissão em si continua sendo do portão do painel e do servidor; isto só
// garante que o destino guardado no login não cresce sem decisão.
import { describe, expect, it } from "vitest";

import { destinoPosLogin } from "@/lib/destinoPosLogin";

const ACEITAS = [
  "admin",
  "admin-orders",
  "admin-settings",
  "admin-product-form",
  "admin-financeiro",
] as const;

// Telas `admin*` do roteador (`App.tsx`, mapa de views) fora das aceitas.
const FORA_DA_LISTA = [
  "admin-dashboard",
  "admin-products",
  "admin-pdv",
  "admin-crm",
  "admin-devolucoes",
  "admin-coupons",
  "admin-coupon-form",
  "admin-banners",
  "admin-carousels",
  "admin-app-color",
  "admin-free-shipping-card",
  "admin-shipping",
  "admin-shipping-national",
  "admin-reviews",
  "admin-qa",
  "admin-customers",
  "admin-user-detail",
  "admin-push",
  "admin-notifications",
  "admin-whatsapp-config",
  "admin-about-store",
  "admin-login",
];

describe("destinoPosLogin — financeiro e as telas do painel fora da lista", () => {
  it("requested admin-financeiro manda para admin-financeiro, mesmo vindo do carrinho", () => {
    expect(
      destinoPosLogin({ view: "auth", requested: "admin-financeiro" }),
    ).toBe("admin-financeiro");
    expect(
      destinoPosLogin({
        view: "auth",
        from: "cart",
        requested: "admin-financeiro",
      }),
    ).toBe("admin-financeiro");
  });

  it.each(ACEITAS)("as cinco aceitas (%s) viram destino", (tela) => {
    expect(destinoPosLogin({ view: "auth", requested: tela })).toBe(tela);
  });

  it.each(FORA_DA_LISTA)(
    "%s NÃO vira destino: cai no perfil (ou no from)",
    (tela) => {
      expect(destinoPosLogin({ view: "auth", requested: tela })).toBe(
        "profile",
      );
      expect(
        destinoPosLogin({ view: "auth", from: "orders", requested: tela }),
      ).toBe("orders");
    },
  );
});
