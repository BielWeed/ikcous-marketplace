import type { TelaDeEntrada } from "@/config/rotas";

// Declaração ÚNICA do nome de cada tela do painel e da porta de cada sub-tela
// (spec 2026-10-09 painel-simples §2 e §3). Menu, título, "carregando",
// Voltar e ajuda leem daqui: um nome por tela, uma porta por função.
//
// As rotas NÃO mudam de nome — só os rótulos e as portas. Por isso as chaves
// derivam de TELAS_DE_ENTRADA (a declaração das rotas): se uma rota entrar ou
// sair de lá, o tipo quebra aqui em vez de apodrecer em silêncio.

/** Toda tela do painel: `admin` e `admin-*`, menos a tela de entrada. */
export type TelaDoPainel = Exclude<
  Extract<TelaDeEntrada, "admin" | `admin-${string}`>,
  "admin-login"
>;

export const NOMES_DO_PAINEL = {
  admin: "Início",
  "admin-dashboard": "Início",
  "admin-pdv": "Vender",
  "admin-crm": "Relatórios",
  "admin-financeiro": "Financeiro",
  "admin-orders": "Pedidos",
  "admin-devolucoes": "Devoluções",
  "admin-products": "Produtos",
  "admin-product-form": "Produto",
  "admin-coupons": "Cupons",
  "admin-coupon-form": "Cupom",
  "admin-customers": "Clientes",
  "admin-user-detail": "Ficha do cliente",
  "admin-qa": "Perguntas",
  "admin-reviews": "Avaliações",
  "admin-push": "Avisar clientes",
  "admin-settings": "Ajustes",
  "admin-about-store": "Minha loja",
  "admin-whatsapp-config": "Minha loja",
  "admin-banners": "Banners",
  "admin-carousels": "Vitrines",
  "admin-shipping": "Entrega e frete",
  "admin-shipping-national": "Entrega e frete",
  "admin-notifications": "Notificações",
} as const satisfies Record<TelaDoPainel, string>;

/** As 5 abas do menu, na ordem em que aparecem. */
export const ABAS_DO_PAINEL = [
  "inicio",
  "pedidos",
  "produtos",
  "clientes",
  "ajustes",
] as const;

export type Aba = (typeof ABAS_DO_PAINEL)[number];

/**
 * As sub-telas que têm EXATAMENTE uma porta, e a aba onde ela mora.
 * Ficam de fora, de propósito:
 *  - a raiz de cada aba (a própria aba é a porta);
 *  - as filhas de lista (`admin-product-form`, `admin-coupon-form`,
 *    `admin-user-detail`): abrem de dentro da lista;
 *  - `admin-pdv` (botão redondo Vender) e `admin-notifications` (sino);
 *  - os APELIDOS (só link antigo).
 *
 * Perguntas e Avaliações são DUAS telas atrás de UMA porta: quem desenha as
 * portas (AtalhosDaAba) funde o par em "Perguntas e avaliações", e o
 * AlternadorDeTelas leva de uma à outra.
 */
export const PORTAS_DO_PAINEL = {
  inicio: ["admin-crm", "admin-financeiro"],
  pedidos: ["admin-devolucoes"],
  produtos: ["admin-coupons"],
  clientes: ["admin-qa", "admin-reviews", "admin-push"],
  ajustes: [
    "admin-about-store",
    "admin-banners",
    "admin-carousels",
    "admin-shipping",
  ],
} as const satisfies Record<Aba, readonly TelaDoPainel[]>;

/** O par que divide uma porta só, em Clientes. */
export const PAR_PERGUNTAS_E_AVALIACOES = [
  "admin-qa",
  "admin-reviews",
] as const satisfies readonly TelaDoPainel[];

export const NOME_DO_PAR_PERGUNTAS_E_AVALIACOES = "Perguntas e avaliações";

/**
 * Rotas que viram apelido: continuam abrindo (link antigo, push já enviado),
 * mas não são tela própria nem têm porta. `vira` é a tela que atende de
 * verdade; `secao` é onde ela abre, quando faz diferença.
 */
export const APELIDOS = {
  admin: { vira: "admin-dashboard" },
  "admin-whatsapp-config": { vira: "admin-about-store", secao: "contato" },
  "admin-shipping-national": { vira: "admin-shipping", secao: "nacional" },
} as const satisfies Partial<
  Record<TelaDoPainel, { readonly vira: TelaDoPainel; readonly secao?: string }>
>;
