// @vitest-environment jsdom
//
// O `mapRecord` de cada tabela do `RealtimeSyncEngine` traduz a linha CRUA do
// Supabase para o formato que o app guarda no cofre do aparelho (e que a vitrine
// lê offline). Um nome de coluna trocado ou um padrão errado não dá erro: o
// banner volta sem subtítulo, a categoria perde o ícone, a loja volta com o
// frete grátis zerado. Aqui cada coluna é provada com um valor DIFERENTE (para
// uma troca de coluna aparecer) e cada padrão com o valor de borda (ausente,
// nulo, vazio, zero, falso). Dados inventados.
import { describe, expect, it, vi } from "vitest";

// O client real do Supabase não constrói em jsdom; nenhum caso aqui usa a rede.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const { TABLE_CONFIGS } = await import("@/lib/realtimeSyncEngine");

function mapear(tabela: string, raw: Record<string, unknown>) {
  const config = TABLE_CONFIGS.find((c) => c.table === tabela);
  expect(config?.mapRecord).toBeTypeOf("function");
  return config!.mapRecord!(raw);
}

describe("mapRecord de categorias", () => {
  it("traduz cada coluna para o seu campo", () => {
    expect(
      mapear("categorias", {
        id: "c1",
        nome: "Moda",
        slug: "moda-infantil",
        descricao: "Roupas",
        ativo: false,
        icone: "camiseta",
        icone_forma: "redondo",
        created_at: "2026-01-02T03:04:05Z",
      }),
    ).toStrictEqual({
      id: "c1",
      name: "Moda",
      slug: "moda-infantil",
      description: "Roupas",
      isActive: false,
      icone: "camiseta",
      iconeForma: "redondo",
      createdAt: "2026-01-02T03:04:05Z",
    });
  });

  it("banco antigo (só id e nome): texto vazio, ativa, sem ícone nem forma", () => {
    expect(mapear("categorias", { id: "c1", nome: "Moda" })).toStrictEqual({
      id: "c1",
      name: "Moda",
      slug: "",
      description: "",
      isActive: true,
      icone: null,
      iconeForma: null,
      createdAt: undefined,
    });
  });

  it("colunas nulas valem como ausentes; 'ativo' nulo NÃO desativa a categoria", () => {
    const mapeada = mapear("categorias", {
      id: "c1",
      nome: "Moda",
      slug: null,
      descricao: null,
      ativo: null,
      icone: null,
      icone_forma: null,
    });
    expect(mapeada.slug).toBe("");
    expect(mapeada.description).toBe("");
    expect(mapeada.isActive).toBe(true);
    expect(mapeada.icone).toBeNull();
    expect(mapeada.iconeForma).toBeNull();
  });

  it("'ativo' falso desativa; slug e descrição vazios continuam vazios", () => {
    const mapeada = mapear("categorias", {
      id: "c1",
      nome: "Moda",
      slug: "",
      descricao: "",
      ativo: false,
    });
    expect(mapeada.isActive).toBe(false);
    expect(mapeada.slug).toBe("");
    expect(mapeada.description).toBe("");
  });
});

describe("mapRecord de banners", () => {
  const completo = {
    id: "b1",
    image_url: "https://exemplo.test/mobile.jpg",
    imagem_url: "https://exemplo.test/antigo.jpg",
    desktop_image_url: "https://exemplo.test/desktop.jpg",
    title: "Liquidação",
    link: "/categoria/moda",
    position: "hero",
    active: false,
    ativo: true,
    order: 4,
    subtitle: "Até 50%",
    subtitle_color: "#111111",
    title_color: "#222222",
    button_text: "Ver agora",
    button_bg_color: "#333333",
    button_text_color: "#444444",
    font_family: "Poppins",
    overlay_color: "#555555",
    overlay_opacity: "0.4",
    badge_text: "Novo",
    template_type: "destaque",
    product_id: "p9",
    start_date: "2026-11-01T00:00:00Z",
    end_date: "2026-11-30T23:59:59Z",
    show_text_overlay: false,
  };

  it("traduz cada coluna para o seu campo (a imagem nova vence a antiga)", () => {
    expect(mapear("banners", completo)).toStrictEqual({
      id: "b1",
      imageUrl: "https://exemplo.test/mobile.jpg",
      desktopImageUrl: "https://exemplo.test/desktop.jpg",
      title: "Liquidação",
      link: "/categoria/moda",
      position: "hero",
      active: false,
      order: 4,
      subtitle: "Até 50%",
      subtitleColor: "#111111",
      titleColor: "#222222",
      buttonText: "Ver agora",
      buttonBgColor: "#333333",
      buttonTextColor: "#444444",
      fontFamily: "Poppins",
      overlayColor: "#555555",
      overlayOpacity: 0.4,
      badgeText: "Novo",
      templateType: "destaque",
      productId: "p9",
      startDate: "2026-11-01T00:00:00Z",
      endDate: "2026-11-30T23:59:59Z",
      showTextOverlay: false,
    });
  });

  it("banner só com o id: textos vazios, datas nulas, modelo 'default', ativo e com texto", () => {
    expect(mapear("banners", { id: "b1" })).toStrictEqual({
      id: "b1",
      imageUrl: undefined,
      desktopImageUrl: null,
      title: "",
      link: undefined,
      position: undefined,
      active: true,
      order: 0,
      subtitle: "",
      subtitleColor: "",
      titleColor: "",
      buttonText: "",
      buttonBgColor: "",
      buttonTextColor: "",
      fontFamily: "",
      overlayColor: "",
      overlayOpacity: undefined,
      badgeText: "",
      templateType: "default",
      productId: undefined,
      startDate: null,
      endDate: null,
      showTextOverlay: true,
    });
  });

  it("colunas vazias ou nulas viram o mesmo padrão que as ausentes", () => {
    const mapeado = mapear("banners", {
      id: "b1",
      image_url: "",
      imagem_url: "https://exemplo.test/antigo.jpg",
      desktop_image_url: "",
      link: "",
      order: null,
      product_id: "",
      start_date: "",
      end_date: "",
      template_type: "",
      show_text_overlay: null,
      overlay_opacity: null,
    });
    expect(mapeado.imageUrl).toBe("https://exemplo.test/antigo.jpg");
    expect(mapeado.desktopImageUrl).toBeNull();
    expect(mapeado.link).toBeUndefined();
    expect(mapeado.order).toBe(0);
    expect(mapeado.productId).toBeUndefined();
    expect(mapeado.startDate).toBeNull();
    expect(mapeado.endDate).toBeNull();
    expect(mapeado.templateType).toBe("default");
    expect(mapeado.showTextOverlay).toBe(true);
    expect(mapeado.overlayOpacity).toBeUndefined();
  });

  it("'active' nulo cai na coluna antiga 'ativo'; sem nenhuma das duas, o banner está ativo", () => {
    expect(
      mapear("banners", { id: "b", active: null, ativo: false }).active,
    ).toBe(false);
    expect(
      mapear("banners", { id: "b", active: null, ativo: true }).active,
    ).toBe(true);
    expect(mapear("banners", { id: "b", ativo: false }).active).toBe(false);
    expect(mapear("banners", { id: "b", active: false }).active).toBe(false);
    expect(mapear("banners", { id: "b" }).active).toBe(true);
    expect(mapear("banners", { id: "b", active: null }).active).toBe(true);
  });

  it("opacidade zero é opacidade zero (não 'ausente'); texto numérico vira número", () => {
    expect(
      mapear("banners", { id: "b", overlay_opacity: 0 }).overlayOpacity,
    ).toBe(0);
    expect(
      mapear("banners", { id: "b", overlay_opacity: "0" }).overlayOpacity,
    ).toBe(0);
    expect(
      mapear("banners", { id: "b", overlay_opacity: "0.75" }).overlayOpacity,
    ).toBe(0.75);
  });

  it("'show_text_overlay' falso esconde o texto; só o ausente/nulo liga", () => {
    expect(
      mapear("banners", { id: "b", show_text_overlay: false }).showTextOverlay,
    ).toBe(false);
    expect(
      mapear("banners", { id: "b", show_text_overlay: true }).showTextOverlay,
    ).toBe(true);
  });
});

describe("mapRecord de store_config", () => {
  const completa = {
    free_shipping_min: "199.9",
    free_shipping_card_style: "faixa",
    shipping_fee: "15.5",
    whatsapp_number: "11900000001",
    share_text: "Conheça a loja",
    business_hours: "Seg a sex, 9h às 18h",
    enable_reviews: false,
    enable_coupons: true,
    logo_url: "https://exemplo.test/logo.png",
    primary_color: "#010101",
    secondary_color: "#020202",
    accent_color: "#030303",
    branding_assets: { favicon: "f.png" },
    theme_mode: "dark",
    real_time_sales_alerts: true,
    push_marketing_enabled: false,
    min_app_version: "1.5.200",
    origin_cep: "00000-001",
    shipping_provider: "correios",
    enabled_shipping_methods: ["pac", "sedex"],
    shipping_coverage: "nacional",
    local_delivery_fee: "6.5",
    local_cep_range: "38400-000,38499-999",
    local_delivery_enabled: false,
    local_delivery_days: "2",
    home_sections: [{ id: "s1" }],
    national_shipping_strategy: "faixa",
    national_shipping_min: "250",
    national_discount_type: "percentage",
    national_discount_value: "10",
    national_benefit_scope: "frete",
    store_name: "Loja de Teste",
    store_city: "Cidade Teste",
    store_state: "TS",
    store_address: "Rua Inventada, 1",
    store_description: "Descrição inventada",
    store_legal_name: "Loja Teste Ltda",
    store_legal_document: "00000000000000",
    store_support_email: "ajuda@example.test",
    formas_pagamento_entrega: ["pix", "cash"],
  };

  it("traduz cada coluna para o seu campo, e texto numérico vira número", () => {
    expect(mapear("store_config", completa)).toStrictEqual({
      id: "singleton",
      freeShippingMin: 199.9,
      freeShippingCardStyle: "faixa",
      shippingFee: 15.5,
      whatsappNumber: "11900000001",
      shareText: "Conheça a loja",
      businessHours: "Seg a sex, 9h às 18h",
      enableReviews: false,
      enableCoupons: true,
      logoUrl: "https://exemplo.test/logo.png",
      primaryColor: "#010101",
      secondaryColor: "#020202",
      accentColor: "#030303",
      brandingAssets: { favicon: "f.png" },
      themeMode: "dark",
      realTimeSalesAlerts: true,
      pushMarketingEnabled: false,
      minAppVersion: "1.5.200",
      originCep: "00000-001",
      shippingProvider: "correios",
      enabledShippingMethods: ["pac", "sedex"],
      shippingCoverage: "nacional",
      localDeliveryFee: 6.5,
      localCepRange: "38400-000,38499-999",
      localDeliveryEnabled: false,
      localDeliveryDays: 2,
      homeSections: [{ id: "s1" }],
      nationalShippingStrategy: "faixa",
      nationalShippingMin: 250,
      nationalDiscountType: "percentage",
      nationalDiscountValue: 10,
      nationalBenefitScope: "frete",
      storeName: "Loja de Teste",
      storeCity: "Cidade Teste",
      storeState: "TS",
      storeAddress: "Rua Inventada, 1",
      storeDescription: "Descrição inventada",
      storeLegalName: "Loja Teste Ltda",
      storeLegalDocument: "00000000000000",
      storeSupportEmail: "ajuda@example.test",
      formasPagamentoEntrega: ["pix", "cash"],
    });
  });

  const NUMERICAS = [
    ["free_shipping_min", "freeShippingMin"],
    ["shipping_fee", "shippingFee"],
    ["local_delivery_fee", "localDeliveryFee"],
    ["local_delivery_days", "localDeliveryDays"],
    ["national_shipping_min", "nationalShippingMin"],
    ["national_discount_value", "nationalDiscountValue"],
  ] as const;

  it.each(NUMERICAS)(
    "%s: ausente ou nula fica 'sem valor' (undefined), e ZERO continua sendo zero",
    (coluna, campo) => {
      // `Reflect.get`: indexar objeto com chave variável dispara
      // `security/detect-object-injection` neste projeto.
      const lido = (raw: Record<string, unknown>) =>
        Reflect.get(mapear("store_config", raw), campo);
      expect(lido({})).toBeUndefined();
      expect(lido({ [coluna]: null })).toBeUndefined();
      expect(lido({ [coluna]: 0 })).toBe(0);
      expect(lido({ [coluna]: "0" })).toBe(0);
      expect(lido({ [coluna]: "12.5" })).toBe(12.5);
    },
  );

  it("colunas de texto opcionais: nula vira undefined (não grava null por cima do que já existe)", () => {
    const mapeada = mapear("store_config", {
      free_shipping_card_style: null,
      local_delivery_enabled: null,
      national_shipping_strategy: null,
      national_benefit_scope: null,
    });
    expect(mapeada.freeShippingCardStyle).toBeUndefined();
    expect(mapeada.localDeliveryEnabled).toBeUndefined();
    expect(mapeada.nationalShippingStrategy).toBeUndefined();
    expect(mapeada.nationalBenefitScope).toBeUndefined();
  });

  it("texto vazio nas colunas opcionais é preservado: só nulo e ausente viram 'sem valor'", () => {
    const mapeada = mapear("store_config", {
      free_shipping_card_style: "",
      national_shipping_strategy: "",
      national_benefit_scope: "",
    });
    expect(mapeada.freeShippingCardStyle).toBe("");
    expect(mapeada.nationalShippingStrategy).toBe("");
    expect(mapeada.nationalBenefitScope).toBe("");
  });

  it("'só retiro' (entrega própria desligada) NÃO é confundido com 'ausente'", () => {
    expect(
      mapear("store_config", { local_delivery_enabled: false })
        .localDeliveryEnabled,
    ).toBe(false);
    expect(
      mapear("store_config", { local_delivery_enabled: true })
        .localDeliveryEnabled,
    ).toBe(true);
  });

  it("tipo de desconto nacional: ausente fica undefined; um valor passa como veio", () => {
    expect(mapear("store_config", {}).nationalDiscountType).toBeUndefined();
    expect(
      mapear("store_config", { national_discount_type: "fixed" })
        .nationalDiscountType,
    ).toBe("fixed");
    // Hoje o NULO do banco passa como nulo (sem desconto), ao contrário das
    // outras colunas opcionais, que viram undefined: o teste registra isso.
    expect(
      mapear("store_config", { national_discount_type: null })
        .nationalDiscountType,
    ).toBeNull();
  });

  it("a linha sempre vira o registro único 'singleton'", () => {
    expect(mapear("store_config", { id: 7 }).id).toBe("singleton");
  });

  // Loja pronta (20261652000000): o eco do Realtime não pode "confirmar" a
  // loja nova (coluna vazia) nem desconfirmar a que já confirmou.
  it("confirmação da Loja pronta: vazia = falta confirmar; data = confirmado; ausente = campo nem aparece", () => {
    const vazia = mapear("store_config", {
      entrega_confirmada_em: null,
      pagamento_confirmado_em: null,
    });
    expect(vazia.entregaConfirmada).toBe(false);
    expect(vazia.pagamentoConfirmado).toBe(false);
    const comData = mapear("store_config", {
      entrega_confirmada_em: "2026-11-27T12:00:00+00:00",
      pagamento_confirmado_em: "2026-11-27T12:00:00+00:00",
    });
    expect(comData.entregaConfirmada).toBe(true);
    expect(comData.pagamentoConfirmado).toBe(true);
    const semColuna = mapear("store_config", {});
    expect("entregaConfirmada" in semColuna).toBe(false);
    expect("pagamentoConfirmado" in semColuna).toBe(false);
  });
});
