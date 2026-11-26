/* eslint-disable security/detect-non-literal-fs-filename -- Lê só arquivos fixos do repositório (package.json e package-lock.json). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A lista de escolha do painel abre num Radix Popover no computador DENTRO das
// folhas (Radix Dialog modal). As duas peças só se enxergam na mesma pilha de
// camadas se usarem a MESMA cópia do `react-dismissable-layer`: com duas
// cópias, o clique na lista conta como "fora" da folha e a folha fecha. A
// 1.3.x do popover traz a sua própria cópia; por isso a versão fica travada.

type Lock = {
  readonly packages: Record<
    string,
    {
      readonly version?: string;
      readonly dependencies?: Record<string, string>;
    }
  >;
};

const pacote = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  readonly dependencies: Record<string, string>;
};
const lock = JSON.parse(
  readFileSync(resolve("package-lock.json"), "utf8"),
) as Lock;

function copias(nome: string): string[] {
  return Object.keys(lock.packages).filter(
    (caminho) =>
      caminho === `node_modules/${nome}` ||
      caminho.endsWith(`/node_modules/${nome}`),
  );
}

describe("lista de escolha — dependência do popover", () => {
  it("o popover está travado em 1.1.15 exata, sem ^ nem ~", () => {
    expect(pacote.dependencies["@radix-ui/react-popover"]).toBe("1.1.15");
    expect(lock.packages["node_modules/@radix-ui/react-popover"]?.version).toBe(
      "1.1.15",
    );
  });

  it("popover e dialog usam a MESMA (e única) cópia do dismissable-layer", () => {
    expect(copias("@radix-ui/react-dismissable-layer")).toEqual([
      "node_modules/@radix-ui/react-dismissable-layer",
    ]);
    const doPopover =
      lock.packages["node_modules/@radix-ui/react-popover"]?.dependencies?.[
        "@radix-ui/react-dismissable-layer"
      ];
    const doDialog =
      lock.packages["node_modules/@radix-ui/react-dialog"]?.dependencies?.[
        "@radix-ui/react-dismissable-layer"
      ];
    expect(doPopover).toBeDefined();
    expect(doPopover).toBe(doDialog);
  });

  it("e a mesma cópia do focus-scope: a trava de foco da folha pausa enquanto a lista está aberta", () => {
    expect(copias("@radix-ui/react-focus-scope")).toEqual([
      "node_modules/@radix-ui/react-focus-scope",
    ]);
  });

  it("uma cópia só do react-popper (a mesma do dropdown-menu)", () => {
    expect(copias("@radix-ui/react-popper")).toEqual([
      "node_modules/@radix-ui/react-popper",
    ]);
  });
});
