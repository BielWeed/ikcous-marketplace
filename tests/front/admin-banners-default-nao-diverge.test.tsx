// @vitest-environment jsdom
//
// Achado AdminBannersView-1198: o shape do "banner default" (~20 campos:
// title, imageUrl, link, position, active, order, subtitle, titleColor,
// ..., templateType, productId, startDate, endDate, showTextOverlay) era
// reescrito à mão em pelo menos 5 lugares do arquivo — o useState inicial
// do formData, o "initial" de fallback do dirty-check, o "initial" de
// fallback do auto-save (byte-a-byte igual ao anterior) e as duas
// ramificações de handleOpenDialog (editar/criar). Um campo novo que só
// entrasse em um desses blocos deixava o indicador de "alterações não
// salvas" ou o rascunho do auto-save sistematicamente errados, sem erro
// visível.
//
// Este teste prova `defaultBannerFor` e `isBannerFormDirty` diretamente
// (mesmo padrão de tests/front/admin-login-erro-com-message-numerica-nao-
// quebra.test.tsx, que importa um helper puro de uma view de admin sem
// montar o componente): os 5 pontos passam a chamar as MESMAS duas
// funções, então testá-las aqui é testar os 5 de uma vez — divergir um
// deles do resto deixaria de ser possível sem editar a função
// compartilhada.
import { describe, expect, it, vi } from "vitest";

// AdminBannersView importa hooks/contextos que, na cadeia deles, criam o
// client do Supabase no topo do módulo (useAuth -> supabase.ts). Sem chaves
// de ambiente de teste, essa avaliação lança e derruba o import de QUALQUER
// coisa deste arquivo, mesmo as duas funções puras abaixo. Mesmo mock de
// tests/front/admin-banners-ligar-desligar-falha-avisa.test.tsx — os hooks
// nunca são chamados aqui (não montamos o componente), só precisam existir
// para o import estático resolver.
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ banners: [] }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({}),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

const { defaultBannerFor, isBannerFormDirty } = await import(
  "@/views/admin/AdminBannersView"
);

describe("defaultBannerFor — fonte única do banner vazio", () => {
  it("produz o shape completo com os valores default atuais", () => {
    expect(defaultBannerFor("home_middle", 4)).toEqual({
      title: "",
      imageUrl: "",
      link: "",
      position: "home_middle",
      active: true,
      order: 4,
      subtitle: "",
      titleColor: "",
      subtitleColor: "",
      buttonText: "",
      buttonBgColor: "",
      buttonTextColor: "",
      fontFamily: "",
      overlayColor: "",
      overlayOpacity: 40,
      badgeText: "",
      templateType: "default",
      productId: "",
      startDate: null,
      endDate: null,
      showTextOverlay: true,
    });
  });

  it("usa position e order recebidos, sem herdar de uma chamada anterior", () => {
    // Duas chamadas com argumentos diferentes não podem compartilhar
    // estado: cada uma reflete SÓ o que recebeu.
    const a = defaultBannerFor("home_top", 1);
    const b = defaultBannerFor("home_bottom", 9);
    expect(a.position).toBe("home_top");
    expect(a.order).toBe(1);
    expect(b.position).toBe("home_bottom");
    expect(b.order).toBe(9);
  });
});

describe("isBannerFormDirty + defaultBannerFor — new banner nunca nasce 'sujo'", () => {
  it("um formData recém-criado a partir de defaultBannerFor não é dirty contra o mesmo default", () => {
    // Isto é exatamente o par (useState inicial) x (initial do dirty-check)
    // do componente real: os dois usam defaultBannerFor com os mesmos
    // argumentos, então precisam concordar que nada mudou.
    const formData = defaultBannerFor("home_top", 1);
    const initial = { id: "", ...defaultBannerFor("home_top", 1) };
    expect(isBannerFormDirty(formData, initial)).toBe(false);
  });

  it("acusa dirty quando um campo do formData diverge do default", () => {
    const formData = { ...defaultBannerFor("home_top", 1), title: "Promoção" };
    const initial = { id: "", ...defaultBannerFor("home_top", 1) };
    expect(isBannerFormDirty(formData, initial)).toBe(true);
  });
});
