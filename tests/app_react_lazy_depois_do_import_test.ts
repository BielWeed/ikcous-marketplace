// Regressão da issue #504: no Vite dev, React.lazy antes do import de
// React acessa o binding na zona morta temporal e impede o App de abrir.
// A primeira chamada precisa vir depois do import; o build de produção
// sozinho não protege esta ordem na transformação de desenvolvimento.
import {
  assert,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const app = Deno.readTextFileSync(new URL("../src/App.tsx", import.meta.url));

Deno.test("App - React.lazy vem depois do import de React (#504)", () => {
  const posImport = app.indexOf('from "react";');
  const posLazy = app.indexOf("React.lazy(");
  assert(posImport > -1, "o import de React sumiu do App.tsx");
  assert(posLazy > -1, "a chamada React.lazy sumiu do App.tsx");
  assert(
    posLazy > posImport,
    `React.lazy precisa vir DEPOIS do import de React (import=${posImport}, lazy=${posLazy}) - antes dele, o Vite dev acessa React na zona morta temporal (#504)`,
  );
});

function exigirLazyDepoisDosImports(conteudo: string, chamada: string) {
  // Extração restrita ao estilo do App: imports no início da linha,
  // terminados por ponto e vírgula, inclusive multilinha e de efeito colateral.
  // import() dinâmico não é declaração e não participa desta ordem.
  const imports = [...conteudo.matchAll(/^import\s+(?!\()[^;]*;/gm)];
  const ultimoImport = imports.at(-1);
  assert(ultimoImport, "nenhum import estático encontrado no App.tsx");
  const fimDoImport = ultimoImport.index + ultimoImport[0].length;
  const posLazy = conteudo.indexOf(chamada);
  assert(posLazy > -1, `a chamada ${chamada} sumiu do App.tsx`);
  assert(
    posLazy >= fimDoImport,
    `${chamada} precisa vir DEPOIS do último import estático (fim=${fimDoImport}, lazy=${posLazy}) (#515)`,
  );
}

for (const chamada of ["React.lazy(", "lazyWithPreload("]) {
  Deno.test(`App - ${chamada} vem depois do último import estático (#515)`, () => {
    exigirLazyDepoisDosImports(app, chamada);
  });

  Deno.test(`guarda de ${chamada} rejeita import multilinha após a chamada`, () => {
    assertThrows(
      () =>
        exigirLazyDepoisDosImports(
          `import React from "react";
const Tela = ${chamada}() => import("./Tela"));
import {
  helper,
} from "./helper";`,
          chamada,
        ),
      Error,
      "precisa vir DEPOIS do último import estático",
    );
  });

  Deno.test(`guarda de ${chamada} aceita import dinâmico após os estáticos`, () => {
    exigirLazyDepoisDosImports(
      `import React, {
  useState,
} from "react";
import "./estilo.css";
const Tela = ${chamada}() =>
  import("./Tela")
);
import("./outraTela");`,
      chamada,
    );
  });

  Deno.test(`guarda de ${chamada} não passa com fonte vazia ou chamada ausente`, () => {
    assertThrows(
      () => exigirLazyDepoisDosImports("", chamada),
      Error,
      "nenhum import estático encontrado",
    );
    assertThrows(
      () => exigirLazyDepoisDosImports('import React from "react";', chamada),
      Error,
      `a chamada ${chamada} sumiu`,
    );
  });
}
