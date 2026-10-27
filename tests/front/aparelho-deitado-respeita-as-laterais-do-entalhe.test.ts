// Lote 219 (caça 9), item 5: o index.html usa `viewport-fit=cover` (a página
// vai até as bordas, inclusive sob o entalhe/ilha do iPhone) e o manifesto
// libera `orientation: any`. Só o topo e o rodapé tratavam a área segura; com o
// aparelho DEITADO, voltar, textos e botões das bordas esquerda/direita ficavam
// sob o entalhe.
//
// jsdom não calcula `env()` nem layout, então este contrato lê o FONTE (mesmo
// padrão de a-tela-do-cliente-nao-rola-para-o-lado.test.ts): o contêiner raiz
// do app carrega as duas laterais, e a barra de baixo (position: fixed, que
// NÃO herda o recuo do pai) tem a regra própria. Em retrato o `env()` vale 0,
// então nada muda lá. Não foi visto em iPhone real (relatório do lote).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>(["/src/App.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const APP = (new Map(Object.entries(FONTES)).get("/src/App.tsx") ?? "").replace(
  /\r\n/g,
  "\n",
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do proprio repositorio
const CSS = readFileSync(
  new URL("../../src/index.css", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("aparelho deitado — laterais da área segura", () => {
  it("o contêiner raiz do app recua pelas duas laterais do entalhe", () => {
    const raiz = /<div className="([^"]*h-dvh[^"]*)">/.exec(APP);
    expect(raiz, "contêiner raiz do App.tsx sumiu").not.toBeNull();
    const classes = raiz![1] ?? "";
    expect(classes).toContain("pl-[env(safe-area-inset-left,0px)]");
    expect(classes).toContain("pr-[env(safe-area-inset-right,0px)]");
  });

  it("a barra de baixo (fixa) tem o recuo lateral, no componente real e no fallback", () => {
    const regra = /nav\[aria-label="Navegação principal"\]\s*\{([^}]*)\}/.exec(
      CSS,
    );
    expect(
      regra,
      "regra lateral da barra de baixo sumiu do CSS",
    ).not.toBeNull();
    const corpo = regra![1] ?? "";
    expect(corpo).toContain("padding-left: env(safe-area-inset-left, 0px)");
    expect(corpo).toContain("padding-right: env(safe-area-inset-right, 0px)");
  });
});
