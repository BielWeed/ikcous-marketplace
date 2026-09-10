// Gera, no outDir e antes do version.json, os arquivos que a Cloudflare Pages
// precisa para servir a MESMA entrega: entradas estáticas, roteamento da
// função, cabeçalhos, 404 com o documento da loja e o worker do
// compartilhamento. Decisões: central/hospedagem-decisao-adaptador-local.md
// e hospedagem-decisao-rotas-preservadas.md; ensaio aprovado: A7a3.

// Espelho literal de src/config/rotas.ts. Este arquivo é JS nativo sem
// loader; tests/front/hospedagem-rotas.test.ts confronta os dois lados.
export const telasDeEntrada = Object.freeze([
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
]);

const PREFIXO_ADMIN = "admin-";

// O leitor do App.tsx aceita `/admin/<x>` como alias de `/admin-<x>` e uma
// barra final em qualquer forma; a raiz não precisa de regra.
export function formasDeEntrada(telas = telasDeEntrada) {
  const formas = new Set();
  for (const tela of telas) {
    formas.add(`/${tela}`);
    if (tela.startsWith(PREFIXO_ADMIN))
      formas.add(`/admin/${tela.slice(PREFIXO_ADMIN.length)}`);
  }
  return [...formas].sort();
}

export function redirects(telas = telasDeEntrada) {
  const linhas = [];
  for (const forma of formasDeEntrada(telas))
    linhas.push(`${forma} / 200`, `${forma}/ / 200`);
  return `${linhas.join("\n")}\n`;
}

// Só o compartilhamento de produto invoca a função; tudo o mais é estático.
export function routes() {
  const rotas = { version: 1, include: ["/product-detail"], exclude: [] };
  return `${JSON.stringify(rotas)}\n`;
}
