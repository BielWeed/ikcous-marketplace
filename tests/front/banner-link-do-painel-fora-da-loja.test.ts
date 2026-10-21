// O LINK DO BANNER DO LADO DO PAINEL NÃO VAI NO PACOTE DA LOJA.
//
// O defeito que isto trava: `destino-do-banner.ts` é importado pela vitrine
// (BannerCarousel). Tudo o que ele exporta e o painel usa — digitar o link,
// avisar, gravar, `linkDaCategoria` — viajava junto no pacote que qualquer
// visitante baixa (~0,6 kB de JS que a loja nunca chama). O portão de tamanho
// da loja mede em bytes e não diz POR QUÊ subiu; este teste diz.
//
// Duas travas, ambas lendo o que existe e não o que se espera:
//   1. o módulo da loja NÃO exporta o que só o painel chama;
//   2. só arquivos do painel (src/views/admin, src/components/admin) importam
//      o módulo do painel — a vitrine importando-o traria tudo de volta.
// E a fronteira entre os dois: a regra de caminho/http continua UMA só, no
// módulo da loja, e o módulo do painel a usa (link disfarçado segue recusado).
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import * as daLoja from "@/lib/destino-do-banner";
import * as doPainel from "@/lib/link-do-banner-no-painel";

const SO_DO_PAINEL = [
  "AVISO_DE_LINK_RECUSADO",
  "avisoDoLinkDigitado",
  "linkDaCategoria",
  "linkDoBannerParaSalvar",
];

function arquivosDe(pasta: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Varre só `src/`, pasta fixa do repositório; o argumento nunca vem de fora.
  return readdirSync(pasta, { withFileTypes: true }).flatMap((item) => {
    const caminho = join(pasta, item.name);
    if (item.isDirectory()) return arquivosDe(caminho);
    return /\.(ts|tsx)$/.test(item.name) ? [caminho] : [];
  });
}

describe("link do banner: painel fora do pacote da loja", () => {
  it("o módulo da loja não exporta o que só o painel chama", () => {
    for (const nome of SO_DO_PAINEL) {
      expect(Object.keys(daLoja)).not.toContain(nome);
    }
  });

  it("o módulo do painel exporta exatamente o que o painel chama", () => {
    expect(Object.keys(doPainel).sort()).toEqual([...SO_DO_PAINEL].sort());
  });

  it("só o painel importa o módulo do painel", () => {
    const importadores = arquivosDe("src")
      .filter((arquivo) =>
        /from\s+["'][^"']*link-do-banner-no-painel["']/.test(
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- Arquivo listado por `arquivosDe("src")` acima.
          readFileSync(arquivo, "utf-8"),
        ),
      )
      .map((arquivo) => arquivo.split(sep).join("/"))
      .filter((arquivo) => arquivo !== "src/lib/link-do-banner-no-painel.ts");

    expect(importadores.length).toBeGreaterThan(0);
    for (const arquivo of importadores) {
      expect(arquivo).toMatch(/^src\/(views|components)\/admin\//);
    }
  });

  it("a regra de segurança continua única: esquema disfarçado segue recusado", () => {
    // Tab no meio do esquema, esquema perigoso, outro site sem esquema,
    // barra invertida e vazio: as bordas que o módulo da loja decide e o do
    // painel só reaproveita.
    expect(doPainel.linkDoBannerParaSalvar("java\tscript:alert(1)")).toBeNull();
    expect(doPainel.linkDoBannerParaSalvar("javascript:alert(1)")).toBeNull();
    expect(doPainel.linkDoBannerParaSalvar("//outro-site.com")).toBeNull();
    expect(doPainel.linkDoBannerParaSalvar("/\\outro-site.com")).toBeNull();
    expect(doPainel.linkDoBannerParaSalvar("   ")).toBe("");
    expect(doPainel.linkDoBannerParaSalvar(null)).toBe("");
    expect(doPainel.linkDoBannerParaSalvar("wa.me/5511999999999")).toBe(
      "https://wa.me/5511999999999",
    );
    expect(doPainel.linkDoBannerParaSalvar("promocoes/natal")).toBe(
      "/promocoes/natal",
    );
    expect(doPainel.avisoDoLinkDigitado("javascript:alert(1)")).toBe(
      doPainel.AVISO_DE_LINK_RECUSADO,
    );
    expect(doPainel.avisoDoLinkDigitado("/categoria")).toBeNull();
  });

  it("a loja segue lendo o link gravado como antes", () => {
    expect(daLoja.destinoDoBanner("/produtos")).toBe("/");
    expect(daLoja.destinoDoBanner("javascript:alert(1)")).toBeNull();
    expect(daLoja.destinoDoBanner("/?category=Cama & Banho")).toBe(
      "/?category=Cama%20%26%20Banho",
    );
    expect(daLoja.destinoDoBanner("tel:+5511999999999")).toBe(
      "tel:+5511999999999",
    );
  });
});
