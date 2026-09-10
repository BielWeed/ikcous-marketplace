import type { View } from "../types";

// Declaração ÚNICA das telas que o leitor de endereço do App.tsx reconhece.
// A hospedagem (scripts/hospedagem.mjs) gera as entradas estáticas a partir
// do espelho desta lista; tests/front/hospedagem-rotas.test.ts confronta os
// dois lados. Ordem preservada do App.tsx para o diff de revisão ser legível.
// Fora daqui, de propósito: `product`, `admin-sros` e `referral` existem no
// tipo View mas nunca foram entradas reconhecidas — documentado, não corrigido.
export const TELAS_DE_ENTRADA = [
  "home",
  "cart",
  "product-detail",
  "checkout",
  "profile",
  "admin",
  "search",
  "auth",
  "login",
  "favorites",
  "notifications",
  "order-success",
  "orders",
  "order-details",
  "recently-viewed",
  "account-settings",
  "admin-dashboard",
  "admin-products",
  "admin-product-form",
  "admin-orders",
  "admin-coupons",
  "admin-coupon-form",
  "admin-banners",
  "admin-carousels",
  "admin-shipping",
  "admin-settings",
  "admin-reviews",
  "admin-qa",
  "admin-customers",
  "admin-user-detail",
  "admin-push",
  "admin-notifications",
  "admin-whatsapp-config",
  "address-form",
  "admin-login",
  "user-profile",
] as const satisfies readonly View[];

export type TelaDeEntrada = (typeof TELAS_DE_ENTRADA)[number];
