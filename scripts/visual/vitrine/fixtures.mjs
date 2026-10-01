// Dados FALSOS e roteador de rede do harness visual da vitrine (app do
// cliente do IKCOUS Marketplace) — 100% fora do repositório, nenhuma escrita
// em disco do projeto, nenhuma requisição sai daqui para a internet.
//
// A técnica é a MESMA de tests/e2e/kit-jornadas.ts (frente e2e-jornadas):
// o app é servido de um build de verdade (fixture identity mode), e a
// "ficha da loja" que o porteiro (middleware.ts) normalmente injeta no HTML
// em produção é injetada AQUI por `page.route` interceptando o próprio
// documento — src/lib/env-valores.ts lê essa ficha e ela VENCE qualquer
// valor assado no build ("a ficha vence"). Documentado no comentário de
// `resolverAmbientePublicoSupabase` daquele arquivo.
//
// Todo endereço do banco fake usa o host sintético abaixo — nunca resolve de
// verdade (rodar.mjs também mapeia TODO hostname para 127.0.0.1 no Chromium
// via --host-resolver-rules, então nem o DNS sai da máquina).

import { webcrypto } from "node:crypto";

export const REF_FIXTURA = "vitrinevisualfixture"; // 20 chars [a-z0-9], exigido por normalizeSupabaseOrigin
export const ORIGEM_BANCO_FIXTURA = `https://${REF_FIXTURA}.supabase.co`;
export const CHAVE_PUBLICA_FIXTURA =
  "sb_publishable_vitrine_visual_sem_segredo";
export const SHA_FIXTURA = "c".repeat(64);
export const ID_CLIENTE_FIXTURA = "00000000-0000-4000-8000-0000000c11e0";
export const ID_ADMIN_FIXTURA = "00000000-0000-4000-8000-0000000adm00";

// ─── Data/hora congeladas ──────────────────────────────────────────────
// 28/09/2026, 10:00 America/Sao_Paulo (13:00 UTC) — usado tanto para
// congelar Date/performance no navegador (rodar.mjs faz o addInitScript)
// quanto para gerar toda data relativa das fixtures abaixo (pedidos,
// notificações), sempre no PASSADO desse instante.
export const AGORA_ISO = "2026-09-28T13:00:00.000Z";
export const AGORA_MS = Date.parse(AGORA_ISO);

function horasAtras(h) {
  return new Date(AGORA_MS - h * 60 * 60 * 1000).toISOString();
}

// ─── Ficha da loja (identidade + conexão) ─────────────────────────────
// Estrutura IDÊNTICA à que tests/e2e/kit-jornadas.ts monta (mesmos campos,
// mesma forma) — é o que faz `cloneStoreIdentity` (src/lib/storeIdentity.ts)
// aceitar a ficha: ela reconstrói a identidade a partir de um "row" derivado
// dela mesma e compara byte a byte. `identityRevision` NÃO é recalculada
// pelo leitor do cliente (fichaDaLoja.ts só exige string não vazia) — usamos
// uma constante fixa de propósito, sem custo de hash a cada rodada.

function asset(nome, extra) {
  return {
    path: `v1/${SHA_FIXTURA}/${nome}`,
    sha256: SHA_FIXTURA,
    media_type: "image/png",
    bytes: 100,
    ...extra,
  };
}

function construirIdentidade() {
  const origem = ORIGEM_BANCO_FIXTURA;
  const urlFor = (a) => `${origem}/storage/v1/object/public/branding/${a.path}`;

  const header = asset("header.png");
  const loader = asset("loader.png");
  const favicon = asset("favicon.png");
  const appleTouch = asset("apple_touch.png", { width: 180, height: 180 });
  const icon192 = asset("icon_192.png", { width: 192, height: 192 });
  const icon512 = asset("icon_512.png", { width: 512, height: 512 });
  const maskable512 = asset("maskable_512.png", { width: 512, height: 512 });
  const og = asset("og.png", { width: 1200, height: 630 });
  const original = asset("original.png");
  const assets = {
    version: 1,
    originals: [original],
    header,
    loader,
    favicon,
    apple_touch: appleTouch,
    icon_192: icon192,
    icon_512: icon512,
    maskable_512: maskable512,
    og,
  };
  const urls = {
    originals: assets.originals.map(urlFor),
    header: urlFor(header),
    loader: urlFor(loader),
    favicon: urlFor(favicon),
    apple_touch: urlFor(appleTouch),
    icon_192: urlFor(icon192),
    icon_512: urlFor(icon512),
    maskable_512: urlFor(maskable512),
    og: urlFor(og),
  };
  return {
    schemaVersion: 1,
    projectRef: REF_FIXTURA,
    storeName: "Empório Aurora",
    city: "Belo Horizonte",
    state: "MG",
    theme: { primary: "#7C3AED", secondary: "#0EA5E9", accent: "#F59E0B" },
    assets,
    urls,
  };
}

const IDENTIDADE_FIXTURA = construirIdentidade();

/** Monta a ficha completa (schemaVersion 2) para o `host`/`origem` dados. */
export function montarFicha(host, origemDoPreview) {
  const ficha = {
    schemaVersion: 2,
    host,
    identidade: {
      identity: IDENTIDADE_FIXTURA,
      localUrls: IDENTIDADE_FIXTURA.urls,
      publicUrl: origemDoPreview,
      identityRevision: "b".repeat(64),
    },
    conexao: {
      supabaseUrl: ORIGEM_BANCO_FIXTURA,
      publishableKey: CHAVE_PUBLICA_FIXTURA,
    },
    configuracao: {
      mpPublicKey: null,
      vapidPublicKey: null,
      // Pagamento online LIGADO (ao contrário do kit-jornadas de convidado):
      // é o que faz o checkout logado mostrar PIX/cartão em vez de só
      // "na entrega" — a tela que este harness precisa fotografar.
      pagamentoOnline: true,
      manutencao: false,
    },
  };
  return JSON.stringify(ficha).replaceAll("</", "<\\/");
}

// ─── Catálogo (12 produtos, 3 categorias) ─────────────────────────────

const IMAGENS = {
  roupas: `${ORIGEM_BANCO_FIXTURA}/storage/v1/object/public/produtos/roupas.png`,
  calcados: `${ORIGEM_BANCO_FIXTURA}/storage/v1/object/public/produtos/calcados.png`,
  acessorios: `${ORIGEM_BANCO_FIXTURA}/storage/v1/object/public/produtos/acessorios.png`,
};

function produto({
  id,
  nome,
  descricao,
  categoria,
  preco,
  precoOriginal,
  estoque,
  variantes,
  imagem,
  bestseller,
  diasAtras,
}) {
  return {
    id,
    nome,
    descricao,
    preco_venda: preco,
    preco_original: precoOriginal ?? null,
    categoria,
    estoque,
    estoque_minimo: 5,
    ativo: true,
    frete_gratis: preco >= 150,
    is_bestseller: !!bestseller,
    data_cadastro: horasAtras((diasAtras ?? 10) * 24),
    ultima_atualizacao: horasAtras((diasAtras ?? 10) * 24),
    imagem_urls: [imagem],
    sold: Math.max(1, Math.round(estoque / 2)),
    rating: 5,
    review_count: 0,
    tags: [],
    product_variants: variantes ?? [],
  };
}

function variante(idProduto, letra, incremento) {
  return {
    id: `${idProduto}-var-${letra.toLowerCase()}`,
    product_id: idProduto,
    sku: null,
    name: "Tamanho",
    value: letra,
    stock_increment: incremento,
    price_override: null,
    active: true,
  };
}

export const CATEGORIA_ROUPAS = "Roupas";
export const CATEGORIA_CALCADOS = "Calçados";
export const CATEGORIA_ACESSORIOS = "Acessórios";

export const PRODUTOS = [
  produto({
    id: "prod-vestido-linho",
    nome: "Vestido de Linho Midi",
    descricao: "Vestido midi de linho, caimento solto, forro interno.",
    categoria: CATEGORIA_ROUPAS,
    preco: 189.9,
    estoque: 24,
    variantes: [
      variante("prod-vestido-linho", "P", 8),
      variante("prod-vestido-linho", "M", 10),
      variante("prod-vestido-linho", "G", 6),
    ],
    imagem: IMAGENS.roupas,
    bestseller: true,
    diasAtras: 40,
  }),
  produto({
    id: "prod-camiseta-basica",
    nome: "Camiseta Básica Algodão",
    descricao: "Camiseta 100% algodão penteado, corte reto.",
    categoria: CATEGORIA_ROUPAS,
    preco: 59.9,
    precoOriginal: 79.9,
    estoque: 40,
    variantes: [
      variante("prod-camiseta-basica", "P", 15),
      variante("prod-camiseta-basica", "M", 15),
      variante("prod-camiseta-basica", "G", 10),
    ],
    imagem: IMAGENS.roupas,
    diasAtras: 5,
  }),
  produto({
    id: "prod-calca-alfaiataria",
    nome: "Calça Alfaiataria Pantalona",
    descricao: "Calça pantalona de alfaiataria, cintura alta.",
    categoria: CATEGORIA_ROUPAS,
    preco: 219.0,
    estoque: 2,
    variantes: [
      variante("prod-calca-alfaiataria", "38", 1),
      variante("prod-calca-alfaiataria", "40", 1),
    ],
    imagem: IMAGENS.roupas,
    diasAtras: 60,
  }),
  produto({
    id: "prod-blusa-tricot",
    nome: "Blusa de Tricô Canelada",
    descricao: "Blusa de tricô canelado, gola careca.",
    categoria: CATEGORIA_ROUPAS,
    preco: 129.9,
    precoOriginal: 169.9,
    estoque: 18,
    imagem: IMAGENS.roupas,
    diasAtras: 15,
  }),
  produto({
    id: "prod-tenis-branco",
    nome: "Tênis Branco Casual",
    descricao: "Tênis branco de couro sintético, solado em EVA.",
    categoria: CATEGORIA_CALCADOS,
    preco: 249.9,
    estoque: 12,
    variantes: [
      variante("prod-tenis-branco", "37", 4),
      variante("prod-tenis-branco", "38", 4),
      variante("prod-tenis-branco", "39", 4),
    ],
    imagem: IMAGENS.calcados,
    bestseller: true,
    diasAtras: 30,
  }),
  produto({
    id: "prod-sandalia-rasteira",
    nome: "Sandália Rasteira Trançada",
    descricao: "Sandália rasteira trançada, palmilha acolchoada.",
    categoria: CATEGORIA_CALCADOS,
    preco: 89.9,
    precoOriginal: 109.9,
    estoque: 30,
    imagem: IMAGENS.calcados,
    diasAtras: 8,
  }),
  produto({
    id: "prod-bota-coturno",
    nome: "Bota Coturno Feminina",
    descricao: "Bota coturno em couro sintético, cadarço e zíper lateral.",
    categoria: CATEGORIA_CALCADOS,
    preco: 259.0,
    estoque: 3,
    variantes: [
      variante("prod-bota-coturno", "36", 1),
      variante("prod-bota-coturno", "37", 2),
    ],
    imagem: IMAGENS.calcados,
    diasAtras: 50,
  }),
  produto({
    id: "prod-chinelo-slide",
    nome: "Chinelo Slide Emborrachado",
    descricao: "Chinelo slide emborrachado, tiras ajustáveis.",
    categoria: CATEGORIA_CALCADOS,
    preco: 49.9,
    estoque: 60,
    imagem: IMAGENS.calcados,
    diasAtras: 3,
  }),
  produto({
    id: "prod-bolsa-transversal",
    nome: "Bolsa Transversal Couro Sintético",
    descricao: "Bolsa pequena transversal, alça ajustável.",
    categoria: CATEGORIA_ACESSORIOS,
    preco: 139.9,
    estoque: 16,
    imagem: IMAGENS.acessorios,
    bestseller: true,
    diasAtras: 20,
  }),
  produto({
    id: "prod-oculos-sol",
    nome: "Óculos de Sol Redondo",
    descricao: "Óculos de sol com proteção UV400, armação leve.",
    categoria: CATEGORIA_ACESSORIOS,
    preco: 79.9,
    precoOriginal: 99.9,
    estoque: 22,
    imagem: IMAGENS.acessorios,
    diasAtras: 12,
  }),
  produto({
    id: "prod-cinto-couro",
    nome: "Cinto de Couro Legítimo",
    descricao: "Cinto de couro legítimo, fivela metálica.",
    categoria: CATEGORIA_ACESSORIOS,
    preco: 69.9,
    estoque: 4,
    variantes: [
      variante("prod-cinto-couro", "P/M", 2),
      variante("prod-cinto-couro", "G/GG", 2),
    ],
    imagem: IMAGENS.acessorios,
    diasAtras: 25,
  }),
  produto({
    id: "prod-brinco-argola",
    nome: "Brinco Argola Dourada",
    descricao: "Brinco argola banhado a ouro, antialérgico.",
    categoria: CATEGORIA_ACESSORIOS,
    preco: 39.9,
    estoque: 50,
    imagem: IMAGENS.acessorios,
    diasAtras: 6,
  }),
];

export const PRODUTO_SIMPLES = "prod-brinco-argola"; // sem variação, sem promoção
export const PRODUTO_COM_VARIACAO = "prod-vestido-linho"; // com variação, sem promoção
export const PRODUTO_COM_PROMOCAO = "prod-camiseta-basica"; // com variação e promoção
export const PRODUTO_ESTOQUE_BAIXO = "prod-calca-alfaiataria";
export const NOME_PRODUTO_COM_VARIACAO = "Vestido de Linho Midi";
export const NOME_PRODUTO_SEM_VARIACAO = "Brinco Argola Dourada";

// ─── Categorias e banners ──────────────────────────────────────────────

export function linhasCategorias() {
  return [
    {
      id: 1,
      nome: CATEGORIA_ROUPAS,
      slug: "roupas",
      descricao: "",
      ativo: true,
      created_at: horasAtras(24 * 90),
    },
    {
      id: 2,
      nome: CATEGORIA_CALCADOS,
      slug: "calcados",
      descricao: "",
      ativo: true,
      created_at: horasAtras(24 * 90),
    },
    {
      id: 3,
      nome: CATEGORIA_ACESSORIOS,
      slug: "acessorios",
      descricao: "",
      ativo: true,
      created_at: horasAtras(24 * 90),
    },
  ];
}

export function linhasBanners() {
  const imagemBanner = `${ORIGEM_BANCO_FIXTURA}/storage/v1/object/public/banners/topo.png`;
  return [
    {
      id: "banner-topo-1",
      image_url: imagemBanner,
      title: "Coleção Primavera",
      subtitle: "Peças novas toda semana",
      link: null,
      position: "home_top",
      active: true,
      order: 1,
      button_text: "Ver coleção",
      product_id: null,
      start_date: null,
      end_date: null,
    },
    {
      id: "banner-topo-2",
      image_url: imagemBanner,
      title: "Frete grátis acima de R$ 150",
      subtitle: null,
      link: null,
      position: "home_top",
      active: true,
      order: 2,
      button_text: null,
      product_id: null,
      start_date: null,
      end_date: null,
    },
  ];
}

// ─── Config da loja (v_store_config / store_config) ────────────────────

export function linhaConfig() {
  return {
    id: 1,
    store_name: IDENTIDADE_FIXTURA.storeName,
    store_city: IDENTIDADE_FIXTURA.city,
    store_state: IDENTIDADE_FIXTURA.state,
    store_address: "Rua das Palmeiras, 500 — Savassi",
    store_description:
      "Moda feminina com curadoria própria — peças autorais e produção local.",
    logo_url: IDENTIDADE_FIXTURA.urls.header,
    primary_color: IDENTIDADE_FIXTURA.theme.primary,
    secondary_color: IDENTIDADE_FIXTURA.theme.secondary,
    accent_color: IDENTIDADE_FIXTURA.theme.accent,
    branding_assets: IDENTIDADE_FIXTURA.assets,
    business_hours: "Seg a Sex, 9h às 18h — Sáb, 9h às 13h",
    created_at: horasAtras(24 * 365),
    updated_at: horasAtras(24),
    enable_coupons: false,
    enable_reviews: false,
    enabled_shipping_methods: ["local"],
    free_shipping_min: 150,
    home_sections: [],
    local_cep_range: null,
    local_delivery_fee: 12,
    min_app_version: null,
    origin_cep: "38500-000",
    push_marketing_enabled: false,
    real_time_sales_alerts: false,
    share_text: "Olha que achei na Empório Aurora!",
    shipping_coverage: "local",
    shipping_fee: 19.9,
    shipping_provider: "manual",
    theme_mode: "light",
    whatsapp_number: "5531999998888",
    national_shipping_strategy: null,
    national_shipping_min: 0,
    national_discount_type: null,
    national_discount_value: 0,
    national_benefit_scope: "mais_barata",
    formas_pagamento_entrega: ["pix", "card", "cash"],
  };
}

export function linhaConfigDoCartao() {
  return { id: 1, credito: true, debito: true, parcelas_max: 6 };
}

// ─── Cliente logado + endereços ─────────────────────────────────────────

export const CHAVE_DA_SESSAO_FIXTURA = `sb-${REF_FIXTURA}-auth-token`;

function base64Url(texto) {
  return Buffer.from(texto, "utf8").toString("base64url");
}

export function usuarioFixtura(admin) {
  return {
    id: admin ? ID_ADMIN_FIXTURA : ID_CLIENTE_FIXTURA,
    aud: "authenticated",
    role: "authenticated",
    email: admin
      ? "admin.harness@exemplo.invalid"
      : "cliente.harness@exemplo.invalid",
    email_confirmed_at: horasAtras(24 * 200),
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { name: admin ? "Admin da Loja" : "Camila Ferreira" },
    identities: [],
    created_at: horasAtras(24 * 200),
    updated_at: horasAtras(24 * 200),
  };
}

export function sessaoFixtura(admin) {
  const usuario = usuarioFixtura(admin);
  const expiraEm = Math.floor(AGORA_MS / 1000) + 24 * 60 * 60;
  const accessToken = [
    base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64Url(
      JSON.stringify({
        sub: usuario.id,
        aud: "authenticated",
        role: "authenticated",
        email: usuario.email,
        exp: expiraEm,
        iat: expiraEm - 24 * 60 * 60,
        session_id: "00000000-0000-4000-8000-0000000005e5",
      }),
    ),
    "assinatura-ficticia-do-harness",
  ].join(".");
  return {
    access_token: accessToken,
    refresh_token: "refresh-ficticio-do-harness",
    token_type: "bearer",
    expires_in: 24 * 60 * 60,
    expires_at: expiraEm,
    user: usuario,
  };
}

export function enderecosFixtura() {
  return [
    {
      id: "00000000-0000-4000-8000-0000000ad001",
      user_id: ID_CLIENTE_FIXTURA,
      name: "Casa",
      recipient_name: "Camila Ferreira",
      cep: "38500-000",
      street: "Rua das Acácias",
      number: "245",
      complement: "Apto 302",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
      reference: "Próximo à praça",
      is_default: true,
      created_at: horasAtras(24 * 90),
      updated_at: horasAtras(24 * 90),
    },
    {
      id: "00000000-0000-4000-8000-0000000ad002",
      user_id: ID_CLIENTE_FIXTURA,
      name: "Trabalho",
      recipient_name: "Camila Ferreira",
      cep: "01310-100",
      street: "Av. Paulista",
      number: "1000",
      complement: "Sala 12",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      reference: null,
      is_default: false,
      created_at: horasAtras(24 * 30),
      updated_at: horasAtras(24 * 30),
    },
  ];
}

export function itensCarrinhoFixtura() {
  return [
    {
      id: "cart-item-1",
      user_id: ID_CLIENTE_FIXTURA,
      product_id: PRODUTO_COM_VARIACAO,
      variant_id: "prod-vestido-linho-var-m",
      variant_names: "Tamanho: M",
      quantity: 1,
      updated_at: horasAtras(2),
    },
    {
      id: "cart-item-2",
      user_id: ID_CLIENTE_FIXTURA,
      product_id: PRODUTO_SIMPLES,
      variant_id: null,
      variant_names: null,
      quantity: 2,
      updated_at: horasAtras(2),
    },
  ];
}

export function linhasFavoritos() {
  return [
    {
      id: "fav-1",
      user_id: ID_CLIENTE_FIXTURA,
      product_id: "prod-tenis-branco",
      created_at: horasAtras(48),
    },
    {
      id: "fav-2",
      user_id: ID_CLIENTE_FIXTURA,
      product_id: "prod-bolsa-transversal",
      created_at: horasAtras(72),
    },
    {
      id: "fav-3",
      user_id: ID_CLIENTE_FIXTURA,
      product_id: "prod-blusa-tricot",
      created_at: horasAtras(96),
    },
  ];
}

// ─── Pedidos ────────────────────────────────────────────────────────────

function enderecoDoPedido() {
  const e = enderecosFixtura()[0];
  return {
    name: e.recipient_name,
    street: e.street,
    number: e.number,
    complement: e.complement,
    neighborhood: e.neighborhood,
    city: e.city,
    state: e.state,
    cep: e.cep,
    reference: e.reference,
  };
}

function itemDePedido(idProduto, nome, preco, quantidade, imagem) {
  return {
    product_id: idProduto,
    variant_id: null,
    product_name: nome,
    price: preco,
    quantity: quantidade,
    image_url: imagem,
  };
}

export const PEDIDO_EM_PREPARO = "00000000-0000-4000-8000-0000000ped01";
export const PEDIDO_ENTREGUE = "00000000-0000-4000-8000-0000000ped02";

export function linhasPedidos() {
  const enderecoTexto = enderecoDoPedido();
  const base = {
    user_id: ID_CLIENTE_FIXTURA,
    customer_name: "Camila Ferreira",
    customer_data: {
      name: "Camila Ferreira",
      whatsapp: "31999998888",
      addressData: enderecoTexto,
    },
    subtotal: 249.7,
    shipping: 10,
    discount: 0,
    total: 259.7,
    payment_method: "pix",
    metodo_online: "pix",
    coupon_code: null,
    notes: null,
    canal: "online",
    vendedor_id: null,
    valor_devolvido_por_devolucao: 0,
    valor_estornado: 0,
    cancelled_after_shipping: false,
    returned_to_seller_at: null,
    pagamento_recebido_em: null,
    pagamento_recebido_por: null,
  };
  return [
    {
      ...base,
      id: PEDIDO_EM_PREPARO,
      status: "processing",
      payment_status: "pago",
      tracking_code: null,
      created_at: horasAtras(20),
      updated_at: horasAtras(18),
      items: [
        itemDePedido(
          PRODUTO_COM_VARIACAO,
          "Vestido de Linho Midi",
          189.9,
          1,
          IMAGENS.roupas,
        ),
        itemDePedido(
          PRODUTO_SIMPLES,
          "Brinco Argola Dourada",
          39.9,
          1,
          IMAGENS.acessorios,
        ),
      ],
      address: enderecosFixtura()[0],
    },
    {
      ...base,
      id: PEDIDO_ENTREGUE,
      status: "delivered",
      payment_status: "pago",
      tracking_code: "BR1234567890BR",
      total: 259.9,
      subtotal: 249.9,
      created_at: horasAtras(24 * 20),
      updated_at: horasAtras(24 * 15),
      items: [
        itemDePedido(
          "prod-tenis-branco",
          "Tênis Branco Casual",
          249.9,
          1,
          IMAGENS.calcados,
        ),
      ],
      address: enderecosFixtura()[0],
    },
  ];
}

// ─── Notificações ────────────────────────────────────────────────────────

export function linhasNotificacoes() {
  return [
    {
      id: "notif-1",
      usuario_id: ID_CLIENTE_FIXTURA,
      titulo: "Pedido a caminho",
      mensagem: "Seu pedido saiu para entrega e chega em breve.",
      tipo: "delivery",
      lida: false,
      created_at: horasAtras(3),
      acao: { url: `/order-details?id=${PEDIDO_EM_PREPARO}` },
      dados: { order_id: PEDIDO_EM_PREPARO },
    },
    {
      id: "notif-2",
      usuario_id: ID_CLIENTE_FIXTURA,
      titulo: "Pagamento aprovado",
      mensagem: "Recebemos o pagamento do seu pedido.",
      tipo: "order",
      lida: true,
      created_at: horasAtras(20),
      acao: { url: `/order-details?id=${PEDIDO_EM_PREPARO}` },
      dados: { order_id: PEDIDO_EM_PREPARO },
    },
    {
      id: "notif-campanha-1",
      usuario_id: null,
      titulo: "Semana da Primavera",
      mensagem: "Até 30% de desconto em peças selecionadas.",
      tipo: "promotion",
      lida: false,
      created_at: horasAtras(30),
      acao: null,
      dados: null,
    },
  ];
}

// ─── Web Crypto (não usado para validar nada no cliente hoje, mas mantido
// por clareza — identityRevision real seria assim) ───────────────────────
export async function shaFixo() {
  const bytes = new TextEncoder().encode("vitrine-visual");
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
