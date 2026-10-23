// O esqueleto de "carregando" do painel segue o tema.
//
// Defeito (23/10/2026): o brilho do Skeleton (`.shimmer`) tem cinza escuro fixo
// sob `.dark`, e o painel sempre leva `.dark`. Nos temas Claro e Confortável o
// esqueleto aparecia quase preto sobre o cartão claro. A correção mora em
// temas-do-painel.css: nos dois temas o brilho usa os tokens do tema.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê os CSS do próprio repositório */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const TEMAS = readFileSync(
  join(RAIZ, "src/components/layouts/temas-do-painel.css"),
  "utf8",
);
const BASE = readFileSync(join(RAIZ, "src/index.css"), "utf8");

function bloco(css: string, seletor: string): string {
  const inicio = css.indexOf(`${seletor} {`);
  expect(inicio, `regra "${seletor}" ausente`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

describe("esqueleto do painel segue o tema", () => {
  it("o brilho base continua escuro sob .dark (Escuro e a vitrine escura intactos)", () => {
    expect(bloco(BASE, ".dark .shimmer")).toContain("#27272a");
  });

  it("nos temas do painel o brilho usa os tokens do tema, não cinza fixo", () => {
    const regra = bloco(TEMAS, "html.admin-mode[data-admin-tema] .shimmer");
    expect(regra).toMatch(/--bg-shimmer-from:\s*hsl\(var\(--admin-raised\)\)/);
    expect(regra).toMatch(/--bg-shimmer-via:\s*hsl\(var\(--admin-hover\)\)/);
    expect(regra).toMatch(/--bg-shimmer-to:\s*hsl\(var\(--admin-raised\)\)/);
    expect(regra).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  // Especificidade (sem teste: jsdom não resolve CSS): `.dark .shimmer` vale
  // 0,2,0 e `html.admin-mode[data-admin-tema] .shimmer` vale 0,3,1; as duas
  // são regras soltas, então a segunda vence sem `!important`. Quem prova a
  // cor de verdade é a conferência no navegador.
});
