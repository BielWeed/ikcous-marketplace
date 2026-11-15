/* eslint-disable security/detect-non-literal-fs-filename -- Lê somente fontes locais fixas para conferir o contrato responsivo, sem entrada de usuário. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "postcss";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

function lerFonte(caminho: string) {
  return readFileSync(resolve(caminho), "utf8");
}

const css = parse(lerFonte("src/index.css").replace(/\r\n/g, "\n"));

// Trechos literais conferidos na base 84a35d769. A execução não consulta histórico.
const ALTURA_E_OFFSET_DO_CELULAR = `    --nav-height: 64px;
    --customer-nav-offset: 0px;`;
const RESERVA_DO_CELULAR = `    --customer-pb: calc(
      var(--nav-height) +
      var(--safe-area-bottom, 0px) +
      var(--visual-bottom-offset, 0px) +
      var(--customer-nav-offset) +
      var(--customer-footer-height, 0px) +
      16px
    );
    --customer-pb-summary: var(--customer-pb);`;
const REGRA_DO_TABLET = `@media (width >= 768px) {
  :root {
    --customer-nav-offset: 24px;
  }
}`;
const REGRA_DO_COMPUTADOR = `@media (min-width: 1024px) {
  :root {
    --customer-pb: calc(
      var(--safe-area-bottom, 0px) +
      var(--visual-bottom-offset, 0px) +
      var(--customer-footer-height, 0px) +
      16px
    );
  }
}`;

describe("P26 — reserva inferior sem navegação escondida no computador", () => {
  it("preserva a reserva do celular idêntica ao literal da base", () => {
    const raizes: string[] = [];
    css.walkRules(":root", (regra) => {
      const contexto = regra.parent;
      if (
        contexto?.type === "atrule" &&
        contexto.name === "layer" &&
        contexto.params === "base"
      ) {
        raizes.push(regra.toString());
      }
    });
    expect(raizes).toHaveLength(1);
    expect(raizes[0]).toContain(ALTURA_E_OFFSET_DO_CELULAR);
    expect(raizes[0]).toContain(RESERVA_DO_CELULAR);
  });

  it("a partir de 1024px redefine somente a reserva, sem a navegação e sua folga", () => {
    const regras: string[] = [];
    css.walkAtRules("media", (regra) => {
      if (regra.params === "(min-width: 1024px)") {
        regras.push(regra.toString());
      }
    });
    expect(regras).toEqual([REGRA_DO_COMPUTADOR]);
  });

  it("preserva os 24px do tablet 768–1023px idênticos ao literal da base", () => {
    const regras: string[] = [];
    css.walkAtRules("media", (regra) => {
      if (regra.params === "(width >= 768px)") {
        regras.push(regra.toString());
      }
    });
    expect(regras).toEqual([REGRA_DO_TABLET]);
  });

  it("cola Salvar endereço no chão do PC sem mudar classes de celular/tablet", () => {
    const fonte = lerFonte("src/components/ui/custom/AddressForm.tsx");
    const classes =
      fonte.match(/className="(bottom-docked-navigation sticky[^"]*)"/)?.[1] ??
      "";
    expect(classesDoCelular(classes)).toBe(
      "bottom-docked-navigation sticky z-20 -mx-1 mt-auto border-t border-border bg-background/95 px-1 pb-2.5 pt-3 backdrop-blur md:bottom-[104px]",
    );
    expect(classes.split(/\s+/)).toContain("lg:bottom-0");
  });
});
