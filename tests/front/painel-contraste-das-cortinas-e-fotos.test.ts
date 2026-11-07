/* eslint-disable security/detect-non-literal-fs-filename -- lê apenas fontes do repositório */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ler = (arquivo: string) =>
  readFileSync(join(__dirname, "../../", arquivo), "utf8");
const css = ler("src/components/layouts/temas-do-painel.css");
const escopo = "html.admin-mode[data-admin-tema]";
const foraDoTemaFixo = ":where(:not([data-tema-fixo], [data-tema-fixo] *))";

function regra(seletor: string) {
  const normalizar = (texto: string) => texto.replace(/\s/g, "");
  const regras = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g);
  const encontrada = [...regras].find(
    ([_, cabecalho]) => normalizar(cabecalho) === normalizar(seletor),
  );
  expect(encontrada, seletor).toBeDefined();
  return encontrada?.[2] ?? "";
}

describe("contraste do painel sem mudar a vitrine", () => {
  it.each(["alert-dialog", "dialog", "sheet"])(
    "cortina de %s continua translúcida",
    (slot) => {
      expect(
        regra(`${escopo} [data-slot="${slot}-overlay"]${foraDoTemaFixo}`),
      ).toContain("background-color: rgb(0 0 0 / 0.5)");
    },
  );

  it("cortina dos alertas cancelados escapa da troca por fundo opaco", () => {
    expect(ler("src/views/admin/AlertasCancelados.tsx")).toContain(
      "bg-[rgb(0_0_0/0.5)]",
    );
  });

  it("cada tema declara o esquema dos controles nativos", () => {
    expect(regra(":where(html.admin-mode:not([data-admin-tema]))")).toContain(
      "color-scheme: dark",
    );
    expect(regra('html.admin-mode[data-admin-tema="claro"]')).toContain(
      "color-scheme: light",
    );
    expect(regra('html.admin-mode[data-admin-tema="confortavel"]')).toContain(
      "color-scheme: dark",
    );
    for (const arquivo of ["AdminOrdersView", "AdminCouponFormView"]) {
      expect(ler(`src/views/admin/${arquivo}.tsx`)).not.toContain(
        "[color-scheme:dark]",
      );
    }
  });

  it("abas e hover do recorte usam o fundo do tema apenas no painel", () => {
    expect(
      regra(`${escopo} [data-slot="image-adjuster-tabs"]${foraDoTemaFixo}`),
    ).toContain("background-color: hsl(var(--admin-bg))");
    expect(
      regra(
        `${escopo} [data-slot="image-adjuster-preset"]:hover${foraDoTemaFixo}`,
      ),
    ).toContain("background-color: hsl(var(--admin-raised))");
    const fonte = ler("src/components/ui/custom/ImageAdjuster.tsx");
    expect(fonte).toContain('data-slot="image-adjuster-tabs"');
    expect(fonte).toMatch(
      /aspectRatio === preset\s*\? undefined\s*: "image-adjuster-preset"/,
    );
    // A vitrine conserva suas cores originais.
    expect(fonte).toContain("bg-zinc-950/85");
    expect(fonte).toContain("hover:bg-zinc-900/60");
  });

  it("foto sem imagem e texto escuros seguem os tokens só no painel", () => {
    expect(
      regra(`${escopo} .dark\\:bg-zinc-900\\/50${foraDoTemaFixo}`),
    ).toContain("background-color: hsl(var(--admin-raised))");
    expect(regra(`${escopo} .dark\\:text-zinc-500${foraDoTemaFixo}`)).toContain(
      "color: hsl(var(--admin-text-soft))",
    );
    expect(ler("src/components/LazyImage.tsx")).toContain(
      "dark:bg-zinc-900/50",
    );
  });
});
