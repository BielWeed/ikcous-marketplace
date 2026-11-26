// CONTRATO DE FONTE do fio do receptor da loja fechada no `main.tsx` (anotado
// pelo revisor do PR #1932).
//
// `receptor-da-loja-fechada.test.ts` prova o receptor sozinho; nada provava
// que o app o LIGA. Sem a chamada no `main.tsx`, o Service Worker apaga as
// páginas guardadas e avisa as abas, mas ninguém escuta: a aba aberta segue
// vendendo. E num chunk lazy o aviso que chega enquanto a vitrine guardada
// abre se perde. `main.tsx` monta o app inteiro e o harness não o importa:
// o contrato se prova na FONTE, com o CONTROLE do glob, o mesmo padrão de
// `recuperacao-chunk-contrato-dos-arquivos.test.ts` para
// `instalarCanaisDeErroChunk()`.
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>(["/src/main.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const FONTE = FONTES["/src/main.tsx"] ?? "";

describe("controle: o glob leu o main.tsx", () => {
  it("o fonte existe e é plausível", () => {
    expect(Object.keys(FONTES)).toEqual(["/src/main.tsx"]);
    expect(FONTE.length).toBeGreaterThan(500);
    expect(FONTE.includes("createRoot(")).toBe(true);
  });
});

// O `\r?` antes do `$` é o checkout com CRLF: no multilinha, `$` não come o `\r`.
describe("main.tsx — o receptor da loja fechada nasce no chunk inicial", () => {
  it("importa o receptor de forma estática, nunca por import() dinâmico", () => {
    expect({
      importEstatico:
        /^import \{ instalarReceptorDaLojaFechada \} from "@\/lib\/receptor-da-loja-fechada";\r?$/m.test(
          FONTE,
        ),
      importDinamico: /import\(\s*["'][^"']*receptor-da-loja-fechada/.test(
        FONTE,
      ),
    }).toEqual({ importEstatico: true, importDinamico: false });
  });

  it("chama instalarReceptorDaLojaFechada() no nível do módulo, fora de função ou callback", () => {
    // Na coluna 0 e sozinha na linha: o formatador indenta tudo o que estiver
    // dentro de função, `then` ou `setTimeout`.
    expect(/^instalarReceptorDaLojaFechada\(\);\r?$/m.test(FONTE)).toBe(true);
  });
});
