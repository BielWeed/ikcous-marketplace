// @vitest-environment jsdom
//
// O cache offline de banners não empobrece (conserto 5 da fatia GLM,
// achado acendido pela revisão 20260825-2115).
//
// O DEFEITO: o `mapRecord` de banners no realtimeSyncEngine mapeava só as
// 8 colunas antigas. O `syncAll` dele faz `vault.replaceAll("banners", ...)`
// — substitui a loja inteira do DataVault por objetos empobrecidos. O
// `useBanners` grava no MESMO store os objetos completos; os dois escrevem
// e o último vence. Resultado depois da migration 20261000000000: lojista
// salva banner com subtitulo/selo/modelo → uma reconexão/troca de aba/boot
// → cache frio ou OFFLINE desenha o banner sem subtitulo, sem selo, sem
// botão, no modelo default — "online é um piscar; offline é o estado
// final" (a frase da revisão).
//
// Este teste exige o contrário: o mapRecord do engine devolve a linha com
// TODOS os campos que a loja sabe desenhar — mesmas conversões do
// useBanners (Number para opacidade, datas como vêm, showTextOverlay com
// default true).
import { describe, expect, it, vi } from "vitest";

// `realtimeSyncEngine.ts` importa `@/lib/supabase` no topo do módulo, e o
// client real falha ao construir em jsdom (sem Web Worker). Dublê do
// teste vizinho (realtime-sync-engine-identidade-da-loja) — nenhum caso
// aqui chama a rede, só o `mapRecord` puro.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const { TABLE_CONFIGS } = await import("@/lib/realtimeSyncEngine");

const LINHA_CRUA = {
  id: "b-1",
  image_url: "https://exemplo/img.png",
  title: "Título",
  link: "/promo",
  position: "home",
  active: true,
  order: 3,
  // Os 15 campos que a migration 20261000000000 tornou reais:
  subtitle: "Subtítulo do banner",
  subtitle_color: "#ffffff",
  title_color: "#111111",
  button_text: "Comprar",
  button_bg_color: "#059669",
  button_text_color: "#ffffff",
  font_family: "Inter",
  overlay_color: "#000000",
  overlay_opacity: 40,
  badge_text: "NOVO",
  template_type: "glassmorphic",
  product_id: "p-9",
  start_date: "2026-09-01T12:00:00.000Z",
  end_date: "2026-09-10T12:00:00.000Z",
  show_text_overlay: false,
};

describe("mapRecord de banners (realtimeSyncEngine) não empobrece o cache", () => {
  it("linha crua com os 15 campos volta COMPLETA — mesmas conversões do useBanners", () => {
    const config = TABLE_CONFIGS.find((c) => c.table === "banners");
    expect(config).toBeDefined();

    const mapeado: Record<string, unknown> = config!.mapRecord!(
      LINHA_CRUA,
    ) as Record<string, unknown>;

    // As 8 antigas continuam.
    expect(mapeado.id).toBe("b-1");
    expect(mapeado.title).toBe("Título");
    expect(mapeado.order).toBe(3);

    // Os 15 novos sobrevivem ao cache — cada um que some aqui é um campo
    // que o offline vai esquecer.
    expect(mapeado.subtitle).toBe("Subtítulo do banner");
    expect(mapeado.subtitleColor).toBe("#ffffff");
    expect(mapeado.titleColor).toBe("#111111");
    expect(mapeado.buttonText).toBe("Comprar");
    expect(mapeado.buttonBgColor).toBe("#059669");
    expect(mapeado.buttonTextColor).toBe("#ffffff");
    expect(mapeado.fontFamily).toBe("Inter");
    expect(mapeado.overlayColor).toBe("#000000");
    expect(mapeado.overlayOpacity).toBe(40);
    expect(mapeado.badgeText).toBe("NOVO");
    expect(mapeado.templateType).toBe("glassmorphic");
    expect(mapeado.productId).toBe("p-9");
    expect(mapeado.startDate).toBe("2026-09-01T12:00:00.000Z");
    expect(mapeado.endDate).toBe("2026-09-10T12:00:00.000Z");
    expect(mapeado.showTextOverlay).toBe(false);
  });

  it("default honesto: showTextOverlay ausente vira true (o desenho não some calado)", () => {
    const config = TABLE_CONFIGS.find((c) => c.table === "banners");
    const { show_text_overlay: _omitido, ...semOverlay } = LINHA_CRUA;
    const mapeado = config!.mapRecord!(semOverlay) as Record<string, unknown>;
    expect(mapeado.showTextOverlay).toBe(true);
  });
});
