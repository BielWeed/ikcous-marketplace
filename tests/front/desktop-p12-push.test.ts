import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const fonte = readFileSync("src/views/admin/AdminPushView.tsx", "utf8");
const layout = readFileSync("src/components/layouts/AdminLayout.tsx", "utf8");
const composicao =
  fonte.match(/className="([^"]*max-w-4xl space-y-5[^"]*)"/)?.[1] ?? "";
const grade =
  fonte.match(
    /<div className="([^"]+)">\s*<section[^>]+aria-label="Mensagem"/,
  )?.[1] ?? "";
const previa =
  fonte.match(/<div className="([^"]+)">\s*<PreviaNoCelular/)?.[1] ?? "";

describe("P12 — campanhas push no computador", () => {
  it("amplia a composição com respiro apenas a partir de lg", () => {
    expect(composicao.split(/\s+/)).toEqual(
      expect.arrayContaining(["lg:max-w-6xl", "lg:px-8", "lg:space-y-6"]),
    );
    expect(classesDoCelular(composicao)).toBe(
      "mx-auto w-full min-w-0 max-w-4xl space-y-5 px-5 pb-8 pt-4",
    );
  });

  it("preserva o celular, a árvore, os avisos e toda a lógica de envio da base", () => {
    // A fonte inteira é assinada após normalizar espaços e variantes de PC.
    // O hash inclui a validação do link de pedido e o filtro do histórico no
    // servidor. O aviso fixo de permissão negada acrescenta 4 className;
    // as classes que já existiam continuam idênticas às da base.
    // Nova mudança em texto, handler ou classe móvel continua reprovando.
    // Os avisos de push descrevem o aceite, não a chegada ao aparelho.
    // O botão e o anúncio da continuação flexionam no singular, sem mudar as classes.
    // 1.5.230: o resumo do envio separa recusa de aviso sem confirmação e mostra
    // a demora; só texto e lógica de resumo, as 208 classes ficam iguais.
    const semComputador = fonte
      .replace(/\s+\b(?:lg|xl|2xl):[^\s"'\x60]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    expect(fonte.match(/\bclassName=/g)).toHaveLength(208);
    expect(createHash("sha256").update(semComputador).digest("hex")).toBe(
      "891696d633d36aec583ecd6a90ec208c94dcc17990a7cff2616b4fb0d2e30173",
    );
  });

  it("coloca a prévia ao lado dos três blocos só em xl, sem mudar o DOM", () => {
    expect(classesDoCelular(grade)).toBe("min-w-0 space-y-5");
    expect(grade.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "xl:grid",
        "xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]",
        "xl:items-start",
        "xl:gap-6",
        "xl:space-y-0",
      ]),
    );
    expect(classesDoCelular(previa)).toBe("min-w-0");
    expect(previa.split(/\s+/)).toEqual(
      expect.arrayContaining(["xl:sticky", "xl:top-24", "xl:row-span-3"]),
    );
    expect(grade).not.toMatch(/(?:lg|md):grid/);
  });

  it.each([
    [1024, 1, 656, 0],
    [1280, 2, 536, 352],
    [1536, 2, 712, 352],
    [1920, 2, 712, 352],
  ])(
    "em %i px cabe o editor e a prévia sem apertar os campos",
    (janela, colunasEsperadas, editorEsperado, previaEsperada) => {
      expect(layout).toContain("hidden w-64 shrink-0");
      expect(layout).toContain("max-w-7xl");
      const limite = composicao.includes("lg:max-w-6xl") ? 1152 : 896;
      const padding = composicao.includes("lg:px-8") ? 64 : 40;
      // Margem externa conservadora de 48 px exigida pelo brief, além da
      // lateral (256 px) e do padding próprio da composição.
      const disponivel = Math.min(janela - 256, 1280) - 48;
      const util = Math.min(disponivel, limite) - padding;
      const breakpoint = grade.match(/(lg|xl|2xl):grid\b/)?.[1];
      const inicio = { lg: 1024, xl: 1280, "2xl": 1536 };
      const colunas =
        breakpoint && janela >= inicio[breakpoint as keyof typeof inicio]
          ? 2
          : 1;
      const larguraPrevia =
        colunas === 2 && grade.includes("minmax(0,22rem)") ? 352 : 0;
      const gap = colunas === 2 && grade.includes("xl:gap-6") ? 24 : 0;
      const editor = util - larguraPrevia - gap;
      expect(colunas).toBe(colunasEsperadas);
      expect(editor).toBe(editorEsperado);
      expect(larguraPrevia).toBe(previaEsperada);
      expect(editor).toBeGreaterThanOrEqual(420);
      if (colunas === 2) expect(larguraPrevia).toBeGreaterThanOrEqual(320);
    },
  );
});
