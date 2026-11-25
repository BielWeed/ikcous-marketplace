// Três bordas do rascunho do formulário de banner (`rascunho-do-banner.ts`):
//  - banner antigo SEM a coluna "ativo" vale como ligado: quem não mexeu no
//    "ativo" não pode reativar o banner que a lojista pausou depois;
//  - campo numérico ilegível (texto no lugar do número) é igual a ele mesmo:
//    não pode acusar "o banner mudou" para sempre;
//  - carimbo de salvamento que não é texto (número solto) não prova a idade do
//    rascunho: vale como vencido.
import {
  bannerMudouDepoisDoRascunho,
  rascunhoDoBannerVenceu,
  rascunhoSobreOBannerDeHoje,
} from "@/lib/rascunho-do-banner";
import { describe, expect, it } from "vitest";

describe("rascunho de banner antigo, sem a coluna 'ativo'", () => {
  it("quem só editou o título NÃO reativa o banner pausado depois", () => {
    const resultado = rascunhoSobreOBannerDeHoje(
      {
        // A base é de um banner lido antes de existir a coluna `active`.
        base: { title: "Velho" },
        formData: { title: "Natal", active: true },
      },
      { id: "b1", title: "Velho", active: false },
    );
    expect(resultado.title).toBe("Natal");
    expect(resultado.active).toBe(false);
  });

  it("banner sem 'ativo' e banner ligado não diferem", () => {
    expect(
      bannerMudouDepoisDoRascunho({ title: "A" }, { title: "A", active: true }),
    ).toBe(false);
    expect(
      bannerMudouDepoisDoRascunho(
        { title: "A" },
        { title: "A", active: false },
      ),
    ).toBe(true);
  });
});

describe("campo numérico ilegível", () => {
  it("a ordem escrita como texto, igual dos dois lados, não conta como mudança", () => {
    const ilegivel = { order: "um" } as unknown as Parameters<
      typeof bannerMudouDepoisDoRascunho
    >[0];
    expect(bannerMudouDepoisDoRascunho(ilegivel, ilegivel)).toBe(false);
  });
});

describe("carimbo de salvamento que não é texto", () => {
  const DOIS_DE_JANEIRO = Date.parse("2026-01-02T00:00:00.000Z");

  it("um número solto (2026) não é data: o rascunho vale como vencido", () => {
    expect(rascunhoDoBannerVenceu({ savedAt: 2026 }, DOIS_DE_JANEIRO)).toBe(
      true,
    );
  });

  it("nulo, objeto e ausente também valem como vencido", () => {
    expect(rascunhoDoBannerVenceu({ savedAt: null }, DOIS_DE_JANEIRO)).toBe(
      true,
    );
    expect(rascunhoDoBannerVenceu({ savedAt: {} }, DOIS_DE_JANEIRO)).toBe(true);
    expect(rascunhoDoBannerVenceu({}, DOIS_DE_JANEIRO)).toBe(true);
    expect(rascunhoDoBannerVenceu(null, DOIS_DE_JANEIRO)).toBe(true);
  });

  it("o mesmo dia escrito como texto vale (controle)", () => {
    expect(
      rascunhoDoBannerVenceu(
        { savedAt: "2026-01-01T00:00:00.000Z" },
        DOIS_DE_JANEIRO,
      ),
    ).toBe(false);
  });
});
