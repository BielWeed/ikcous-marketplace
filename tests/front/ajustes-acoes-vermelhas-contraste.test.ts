import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import colors from "tailwindcss/colors";
import { describe, expect, it } from "vitest";
import { hexParaRgb, razao } from "./contraste-das-classes";

// O gerador de tema remove o "!" do seletor: !text-red-300 escapava da troca
// no Claro. Compile a classe REAL, incluindo a prioridade, sem usar o gerador.
const email = readFileSync(
  "src/components/admin/settings/EmailDaLojaSection.tsx",
  "utf8",
);
const privacidade = readFileSync(
  "src/components/admin/settings/PrivacidadeDosClientesSection.tsx",
  "utf8",
);
const temas = readFileSync(
  "src/components/layouts/temas-do-painel.css",
  "utf8",
);
const CLASSE = "!text-[color:var(--lit-t-ff9999,#fca5a5)]";

describe("ações vermelhas dos ajustes: Claro legível sem mudar o Escuro", () => {
  it("os três botões usam o vermelho de tema, não o pastel prioritário", () => {
    expect(email.includes("!text-red-300")).toBe(false);
    expect(privacidade.includes("!text-red-300")).toBe(false);
    expect(email.split(CLASSE)).toHaveLength(3);
    expect(privacidade.split(CLASSE)).toHaveLength(2);
  });

  it("a classe compila com prioridade sobre ajustes-secundario", async () => {
    const resultado = await postcss([
      tailwindcss({
        content: [{ raw: CLASSE, extension: "html" }],
        corePlugins: { preflight: false },
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    const cores: string[] = [];
    resultado.root.walkDecls("color", (declaracao) => {
      expect(declaracao.important).toBe(true);
      cores.push(declaracao.value);
    });
    expect(cores).toEqual(["var(--lit-t-ff9999,#fca5a5)"]);
  });

  it("o token real tem contraste AA no Claro e o fallback mantém red-300", () => {
    const raiz = postcss.parse(temas);
    let vermelho = "";
    let elevado = "";
    raiz.walkRules('html.admin-mode[data-admin-tema="claro"]', (regra) => {
      regra.walkDecls("--lit-t-ff9999", (d) => {
        vermelho = d.value;
      });
      regra.walkDecls("--admin-raised", (d) => {
        elevado = d.value;
      });
    });
    // Protege a superfície real sobre a qual estes botões são desenhados.
    expect(elevado).toBe("240 12.8% 92.4%");
    const claro = hexParaRgb(vermelho);
    expect(razao(claro, hexParaRgb("#e9e9ee"))).toBeGreaterThanOrEqual(4.5);
    expect(razao(claro, hexParaRgb("#ffffff"))).toBeGreaterThanOrEqual(4.5);
    expect(CLASSE).toContain(`,${colors.red[300]})]`);
  });
});
