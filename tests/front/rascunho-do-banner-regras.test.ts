// O rascunho do formulário de banner, nas bordas que a tela esconde: quando ele
// vence (7 dias, contados do último salvamento, no milissegundo), o que fazer
// com um rascunho de outro banner, de banner antigo sem `base` ou ilegível, e
// quais campos ele devolve por cima do banner de HOJE.
//
// As funções são puras: o `agora` é sempre passado, nunca lido do relógio.
import {
  PRAZO_DO_RASCUNHO_DO_BANNER_MS,
  bannerMudouDepoisDoRascunho,
  baseDoRascunho,
  rascunhoDoBannerVenceu,
  rascunhoSobreOBannerDeHoje,
  situacaoDoRascunhoDoBanner,
} from "@/lib/rascunho-do-banner";
import type { Banner } from "@/types";
import { describe, expect, it } from "vitest";

const SALVO_EM = "2026-11-01T12:00:00.000Z";
const SALVO_EM_MS = Date.parse(SALVO_EM);
const NO_PRAZO = SALVO_EM_MS + PRAZO_DO_RASCUNHO_DO_BANNER_MS;

const banner = (extra: Partial<Banner> = {}): Partial<Banner> => ({
  id: "b1",
  title: "Natal",
  imageUrl: "https://x.test/a.jpg",
  position: "home_top",
  active: true,
  order: 1,
  ...extra,
});

describe("quando o rascunho do banner vence", () => {
  it("vale 7 dias exatos, até o último milissegundo; 1 ms depois venceu", () => {
    expect(PRAZO_DO_RASCUNHO_DO_BANNER_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(rascunhoDoBannerVenceu({ savedAt: SALVO_EM }, NO_PRAZO)).toBe(false);
    expect(rascunhoDoBannerVenceu({ savedAt: SALVO_EM }, NO_PRAZO + 1)).toBe(
      true,
    );
  });

  it("recém-salvo não venceu", () => {
    expect(rascunhoDoBannerVenceu({ savedAt: SALVO_EM }, SALVO_EM_MS)).toBe(
      false,
    );
  });

  it("sem carimbo legível não dá para provar que vale: venceu", () => {
    for (const savedAt of ["", "ontem", undefined, null, 1_700_000_000_000]) {
      expect(rascunhoDoBannerVenceu({ savedAt }, SALVO_EM_MS)).toBe(true);
    }
    expect(rascunhoDoBannerVenceu(null, SALVO_EM_MS)).toBe(true);
    expect(rascunhoDoBannerVenceu(undefined, SALVO_EM_MS)).toBe(true);
    expect(rascunhoDoBannerVenceu({}, SALVO_EM_MS)).toBe(true);
  });
});

describe("o que fazer com o rascunho guardado ao abrir o editor", () => {
  const valido = (extra: Record<string, unknown> = {}) => ({
    formData: banner(),
    savedAt: SALVO_EM,
    ...extra,
  });

  it("o que não é um objeto de rascunho é ignorado, nunca apagado", () => {
    for (const lixo of [null, undefined, "texto", 42, [], [valido()]]) {
      expect(situacaoDoRascunhoDoBanner(lixo, undefined, SALVO_EM_MS)).toBe(
        "ignorar",
      );
    }
  });

  it("rascunho de banner NOVO, dentro do prazo, é oferecido (mesmo sem `base`)", () => {
    expect(situacaoDoRascunhoDoBanner(valido(), undefined, NO_PRAZO)).toBe(
      "usar",
    );
  });

  it("rascunho de edição com `base`, do mesmo banner, é oferecido", () => {
    const r = valido({ editingBannerId: "b1", base: baseDoRascunho(banner()) });
    expect(situacaoDoRascunhoDoBanner(r, "b1", NO_PRAZO)).toBe("usar");
  });

  it("rascunho de edição SEM `base` é apagado: devolvê-lo inteiro desfaria o banner", () => {
    const r = valido({ editingBannerId: "b1" });
    expect(situacaoDoRascunhoDoBanner(r, "b1", NO_PRAZO)).toBe("descartar");
    // `base` que não é objeto vale como ausente.
    for (const base of [null, "x", []]) {
      expect(situacaoDoRascunhoDoBanner({ ...r, base }, "b1", NO_PRAZO)).toBe(
        "descartar",
      );
    }
  });

  it("rascunho de OUTRO banner não é oferecido nem apagado", () => {
    const r = valido({ editingBannerId: "b1", base: baseDoRascunho(banner()) });
    expect(situacaoDoRascunhoDoBanner(r, "b2", NO_PRAZO)).toBe("ignorar");
    // Editando um banner existente, o rascunho de banner NOVO também é de outro.
    expect(situacaoDoRascunhoDoBanner(valido(), "b2", NO_PRAZO)).toBe(
      "ignorar",
    );
    // Abrindo um banner novo, o rascunho de uma edição é de outro.
    expect(situacaoDoRascunhoDoBanner(r, undefined, NO_PRAZO)).toBe("ignorar");
  });

  it("vencido é apagado, mesmo sendo de outro banner (o prazo vem antes do dono)", () => {
    const r = valido({ editingBannerId: "b1", base: baseDoRascunho(banner()) });
    expect(situacaoDoRascunhoDoBanner(r, "b2", NO_PRAZO + 1)).toBe("descartar");
    expect(situacaoDoRascunhoDoBanner(r, "b1", NO_PRAZO + 1)).toBe("descartar");
  });

  it("rascunho sem carimbo é apagado", () => {
    expect(
      situacaoDoRascunhoDoBanner(
        { formData: banner() },
        undefined,
        SALVO_EM_MS,
      ),
    ).toBe("descartar");
  });
});

describe("a base do rascunho guarda só os campos do formulário", () => {
  it("campo ausente vira null e o que não é do formulário fica de fora", () => {
    const base = baseDoRascunho({ ...banner(), id: "b1", subtitle: undefined });
    expect(base).not.toHaveProperty("id");
    expect(base.title).toBe("Natal");
    expect(base.subtitle).toBeNull();
    expect(base.endDate).toBeNull();
    expect(base.active).toBe(true);
  });
});

describe("o rascunho recuperado por cima do banner de hoje", () => {
  it("devolve só o campo que a lojista editou; o resto fica como o banner está HOJE", () => {
    const aoAbrir = banner({ title: "Natal", active: true, order: 1 });
    const hoje = banner({ title: "Natal", active: false, order: 3 });
    const rascunho = {
      base: baseDoRascunho(aoAbrir),
      formData: { ...aoAbrir, title: "Natal 2026" },
    };

    const resultado = rascunhoSobreOBannerDeHoje(rascunho, hoje);

    expect(resultado.title).toBe("Natal 2026"); // editado: volta
    expect(resultado.active).toBe(false); // pausado depois: não reativa
    expect(resultado.order).toBe(3); // reordenado depois: não volta à ordem velha
  });

  it("vazio, nulo e ausente são o mesmo 'sem valor': não contam como edição", () => {
    const aoAbrir = banner({ subtitle: undefined, startDate: null });
    const hoje = banner({
      subtitle: "Novo texto de hoje",
      startDate: "2026-12-01T00:00:00.000Z",
    });
    const rascunho = {
      base: baseDoRascunho(aoAbrir),
      // O formulário devolveu strings vazias onde o banco tinha nulo/ausente.
      formData: { ...aoAbrir, subtitle: "", startDate: "" },
    };

    const resultado = rascunhoSobreOBannerDeHoje(rascunho, hoje);

    expect(resultado.subtitle).toBe("Novo texto de hoje");
    expect(resultado.startDate).toBe("2026-12-01T00:00:00.000Z");
  });

  const EDICOES: ReadonlyArray<readonly [string, unknown]> = [
    ["title", "Outro título"],
    ["imageUrl", "https://x.test/nova.jpg"],
    ["desktopImageUrl", "https://x.test/nova-pc.jpg"],
    ["link", "/?category=Nova"],
    ["position", "home_bottom"],
    ["active", false],
    ["order", 7],
    ["subtitle", "Subtítulo"],
    ["titleColor", "#ff0000"],
    ["subtitleColor", "#00ff00"],
    ["buttonText", "Comprar"],
    ["buttonBgColor", "#0000ff"],
    ["buttonTextColor", "#ffffff"],
    ["fontFamily", "Georgia"],
    ["overlayColor", "#000000"],
    ["overlayOpacity", 10],
    ["badgeText", "Novo"],
    ["templateType", "split_left"],
    ["productId", "p9"],
    ["startDate", "2026-12-01T09:00:00.000Z"],
    ["endDate", "2026-12-25T23:00:00.000Z"],
    ["showTextOverlay", false],
  ];

  it("a tabela cobre todos os campos que o formulário guarda", () => {
    expect(EDICOES.map(([campo]) => campo).sort()).toEqual(
      Object.keys(baseDoRascunho({})).sort(),
    );
  });

  it.each(EDICOES)(
    "editar '%s' no rascunho: o valor volta ao recuperar",
    (campo, valor) => {
      const aoAbrir = banner();
      const rascunho = {
        base: baseDoRascunho(aoAbrir),
        formData: { ...aoAbrir, [campo]: valor } as Partial<Banner>,
      };

      const resultado = rascunhoSobreOBannerDeHoje(rascunho, banner());

      expect(new Map(Object.entries(resultado)).get(campo)).toEqual(valor);
    },
  );

  it("limpar um campo que tinha valor É uma edição e volta vazio", () => {
    const aoAbrir = banner({ endDate: "2026-12-25T23:59:00.000Z" });
    const hoje = banner({ endDate: "2026-12-25T23:59:00.000Z" });
    const rascunho = {
      base: baseDoRascunho(aoAbrir),
      formData: { ...aoAbrir, endDate: null },
    };

    expect(rascunhoSobreOBannerDeHoje(rascunho, hoje).endDate).toBeNull();
  });

  it("textos sobre o banner: ausente vale 'ligado'; desligar é uma edição", () => {
    const aoAbrir = banner(); // sem showTextOverlay
    const hoje = banner();
    const rascunho = {
      base: baseDoRascunho(aoAbrir),
      formData: { ...aoAbrir, showTextOverlay: false },
    };

    expect(rascunhoSobreOBannerDeHoje(rascunho, hoje).showTextOverlay).toBe(
      false,
    );
    // E ligado explícito é o mesmo que ausente: não é edição.
    const igual = {
      base: baseDoRascunho(aoAbrir),
      formData: { ...aoAbrir, showTextOverlay: true },
    };
    expect(
      rascunhoSobreOBannerDeHoje(igual, banner({ showTextOverlay: false }))
        .showTextOverlay,
    ).toBe(false);
  });

  it("pausar o banner no rascunho é uma edição (active=false não some como 'vazio')", () => {
    const aoAbrir = banner({ active: true });
    const rascunho = {
      base: baseDoRascunho(aoAbrir),
      formData: { ...aoAbrir, active: false },
    };

    expect(
      rascunhoSobreOBannerDeHoje(rascunho, banner({ active: true })).active,
    ).toBe(false);
  });

  it("ordem 0 e ordem ausente são a mesma ordem", () => {
    const aoAbrir = banner({ order: undefined });
    const rascunho = {
      base: baseDoRascunho(aoAbrir),
      formData: { ...aoAbrir, order: 0 },
    };

    expect(
      rascunhoSobreOBannerDeHoje(rascunho, banner({ order: 5 })).order,
    ).toBe(5);
  });

  it("opacidade 0 é uma escolha (não cai no padrão 40)", () => {
    const aoAbrir = banner({ overlayOpacity: undefined }); // equivale a 40
    const rascunho = {
      base: baseDoRascunho(aoAbrir),
      formData: { ...aoAbrir, overlayOpacity: 0 },
    };

    expect(
      rascunhoSobreOBannerDeHoje(rascunho, banner({ overlayOpacity: 70 }))
        .overlayOpacity,
    ).toBe(0);
  });

  it("modelo ausente e 'default' são o mesmo modelo", () => {
    const aoAbrir = banner({ templateType: undefined });
    const rascunho = {
      base: baseDoRascunho(aoAbrir),
      formData: { ...aoAbrir, templateType: "default" },
    };

    expect(
      rascunhoSobreOBannerDeHoje(
        rascunho,
        banner({ templateType: "modelo-foto" }),
      ).templateType,
    ).toBe("modelo-foto");
  });

  it("formulário que não traz a ordem não apaga a ordem de hoje", () => {
    const aoAbrir = banner({ order: 0 });
    const rascunho = {
      base: baseDoRascunho(aoAbrir),
      formData: { ...aoAbrir, order: undefined, title: "Natal 2026" },
    };

    const resultado = rascunhoSobreOBannerDeHoje(
      rascunho,
      banner({ order: 4 }),
    );

    expect(resultado.title).toBe("Natal 2026");
    expect(resultado.order).toBe(4);
  });

  it("rascunho sem `base` (de banner novo) devolve até o que é igual ao padrão", () => {
    // Sem `base` não há como saber o que ela editou: o rascunho inteiro vale,
    // inclusive o campo que coincide com o padrão (ligado, texto vazio).
    const resultado = rascunhoSobreOBannerDeHoje(
      { formData: { title: "Novo", active: true, subtitle: "" } },
      banner({ active: false, subtitle: "texto velho" }),
    );

    expect(resultado.active).toBe(true);
    expect(resultado.subtitle).toBe("");
  });

  it("rascunho sem `base` (de banner novo) volta inteiro por cima do atual", () => {
    const resultado = rascunhoSobreOBannerDeHoje(
      { formData: { title: "Só o título" } },
      banner({ title: "Outro", order: 9 }),
    );

    expect(resultado.title).toBe("Só o título");
    expect(resultado.order).toBe(9);
  });
});

describe("o banner mudou depois do rascunho?", () => {
  it("igual, ou só diferente por vazio/nulo/ausente: não mudou", () => {
    const base = baseDoRascunho(banner({ subtitle: undefined }));
    expect(bannerMudouDepoisDoRascunho(base, banner({ subtitle: "" }))).toBe(
      false,
    );
  });

  it("qualquer campo do formulário diferente: mudou", () => {
    const base = baseDoRascunho(banner());
    expect(bannerMudouDepoisDoRascunho(base, banner({ active: false }))).toBe(
      true,
    );
    expect(
      bannerMudouDepoisDoRascunho(
        base,
        banner({ endDate: "2026-12-31T00:00:00.000Z" }),
      ),
    ).toBe(true);
  });

  it("sem `base` legível ou sem banner atual não há o que comparar: false", () => {
    expect(bannerMudouDepoisDoRascunho(undefined, banner())).toBe(false);
    expect(bannerMudouDepoisDoRascunho(baseDoRascunho(banner()), null)).toBe(
      false,
    );
    expect(
      bannerMudouDepoisDoRascunho(baseDoRascunho(banner()), undefined),
    ).toBe(false);
  });
});
