// Regressão da issue #504: no Vite dev, React.lazy antes do import de
// React acessa o binding na zona morta temporal e impede o App de abrir.
// A primeira chamada precisa vir depois do import; o build de produção
// sozinho não protege esta ordem na transformação de desenvolvimento.
import { assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";

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
