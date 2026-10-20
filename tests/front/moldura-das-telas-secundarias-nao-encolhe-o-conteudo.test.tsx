// @vitest-environment jsdom
//
// O FIM DAS TELAS SECUNDÁRIAS FICAVA ATRÁS DA BARRA DE BAIXO (caçada de
// 14/10/2026, celular 360x640, tela de busca).
//
// A moldura das telas secundárias é uma coluna (`flex-col`) e a raiz de cada
// tela é `min-h-full`. Raiz com `min-h-full` num filho de coluna ENCOLHE até a
// altura do celular (o `min-height:auto` que protegeria o conteúdo é
// substituído pelo `min-h-full`) — e a folga de ~100px do fim da tela
// (`pb-customer`) cai no meio do conteúdo, em vez de no fim. Medido: último
// botão em 566-597 com a barra de navegação começando em 575 (o toque caía na
// barra); com a raiz sem encolher, 466-497.
//
// O conserto está na MOLDURA COMUM, não em cada tela: o filho direto da moldura
// não encolhe (`[&>*]:shrink-0`). Há DUAS molduras (o caminho com View
// Transitions, no App.tsx, e o de navegadores sem elas, em
// AppMotionFallbacks.tsx) e as duas precisam da mesma regra.
//
// O QUE ESTE TESTE NÃO MEDE: o jsdom não calcula layout. Ele prova que a regra
// está nas duas molduras; a medida em pixels foi feita pela caçada, num
// Chrome real, e não foi repetida num celular de verdade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { SecondaryViewMotionShell } from "@/components/layouts/AppMotionFallbacks";

const REGRA = "[&>*]:shrink-0";

const FONTES = import.meta.glob<string>("/src/App.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("moldura das telas secundárias não deixa a tela encolher", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("caminho SEM View Transitions: a moldura de movimento carrega a regra", () => {
    act(() => {
      root.render(
        <SecondaryViewMotionShell
          active
          viewKey="search"
          direction="none"
          transitionScroll={{ oldScroll: 0, newScroll: 0 }}
          duration={0}
        >
          <div data-testid="tela" className="pb-customer min-h-full" />
        </SecondaryViewMotionShell>,
      );
    });
    const tela = container.querySelector('[data-testid="tela"]');
    const moldura = tela?.parentElement;
    expect(moldura).not.toBeNull();
    // Continua sendo a coluna que enche a altura (não se mexeu no resto)...
    expect(moldura?.className).toContain("flex-col");
    // ...e agora o filho direto não encolhe.
    expect(moldura?.className).toContain(REGRA);
  });

  it("caminho COM View Transitions: a moldura do App.tsx carrega a regra", () => {
    // Renderizar o App inteiro só para ler uma classe custaria o app todo; a
    // moldura é identificada pelo `viewTransitionName: "main-content"` que só
    // ela tem, e a classe é lida do mesmo elemento JSX.
    expect(FONTES).toHaveProperty(["/src/App.tsx"]);
    const fonte = FONTES["/src/App.tsx"] as string;
    const molduras = [
      ...fonte.matchAll(
        /<div\s+className="([^"]+)"\s+style=\{\{\s*viewTransitionName:\s*"main-content"\s*\}\}/g,
      ),
    ];
    expect(molduras).toHaveLength(1);
    const classes = molduras[0][1];
    expect(classes).toContain("flex-col");
    expect(classes).toContain(REGRA);
  });
});
