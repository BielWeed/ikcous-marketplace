// Onda 0 do plano app-cliente-desktop (F1.4, guarda do contrato C1/R8): "um
// só leitor de largura". Fora de `src/hooks/useTelaDeComputador.ts` (e do
// painel admin, que fica fora do escopo desta guarda), nenhum arquivo da
// casca da cliente pode ler largura de tela por conta própria -- nem
// `useMediaQuery(`, nem `matchMedia(` com `min-width`/`max-width`.
// `prefers-reduced-motion` e `display-mode` continuam permitidos (são
// consultas de FEATURE, não de largura).
//
// Por quê a guarda importa: o `useMediaQuery` legado (`useState`+`useEffect`)
// só acerta o valor DEPOIS do primeiro paint -- no computador, isso é o
// flash "nasce de celular, pula pra desktop" que o contrato C1 existe para
// evitar. Se alguma frente da Onda 1 ler `matchMedia`/`useMediaQuery` por
// conta própria, essa garantia furou sem ninguém perceber.
//
// Este teste tem DUAS metades:
//   1. prova que o DETECTOR reconhece violação de verdade (senão um detector
//      quebrado passaria "verde" sem proteger nada -- mesma exigência de
//      "a varredura não é vazia" de guarda-de-cor-sai-junto-com-a-escrita);
//   2. varre a casca de verdade e espera ZERO ocorrência hoje ("passa hoje,
//      protege o contrato", como o plano descreve esta tarefa).
import { describe, expect, it } from "vitest";

/**
 * Acha, num texto de fonte, usos de leitor de largura fora do gancho único:
 * qualquer `useMediaQuery(`, e todo `matchMedia(` cuja string de consulta
 * mencione `min-width` ou `max-width`.
 */
function acharLeitoresDeLarguraForaDoGancho(texto: string): string[] {
  const achados: string[] = [];

  if (texto.includes("useMediaQuery(")) {
    achados.push("useMediaQuery(");
  }

  const padraoMatchMediaComString =
    /matchMedia\(\s*(['"`])((?:(?!\1)[\s\S])*)\1/g;
  for (const casamento of texto.matchAll(padraoMatchMediaComString)) {
    const consulta = casamento[2];
    if (/min-width|max-width/.test(consulta)) {
      achados.push(`matchMedia("${consulta}")`);
    }
  }

  return achados;
}

describe("acharLeitoresDeLarguraForaDoGancho — o detector reconhece violação de verdade", () => {
  it("acha useMediaQuery( em qualquer forma de chamada", () => {
    expect(
      acharLeitoresDeLarguraForaDoGancho(
        'const largo = useMediaQuery("(min-width: 1024px)");',
      ),
    ).toContain("useMediaQuery(");
  });

  it("acha matchMedia( com min-width", () => {
    expect(
      acharLeitoresDeLarguraForaDoGancho(
        'window.matchMedia("(min-width: 1024px)")',
      ),
    ).toEqual(['matchMedia("(min-width: 1024px)")']);
  });

  it("acha matchMedia( com max-width", () => {
    expect(
      acharLeitoresDeLarguraForaDoGancho(
        "globalThis.matchMedia('(max-width: 767px)')",
      ),
    ).toEqual(['matchMedia("(max-width: 767px)")']);
  });

  it("NÃO acha matchMedia( de prefers-reduced-motion nem de display-mode", () => {
    expect(
      acharLeitoresDeLarguraForaDoGancho(
        'window.matchMedia("(prefers-reduced-motion: reduce)")',
      ),
    ).toEqual([]);
    expect(
      acharLeitoresDeLarguraForaDoGancho(
        'window.matchMedia("(display-mode: standalone)")',
      ),
    ).toEqual([]);
  });

  it("texto sem nenhum leitor de largura não acha nada", () => {
    expect(
      acharLeitoresDeLarguraForaDoGancho(
        "const computador = useTelaDeComputador();",
      ),
    ).toEqual([]);
  });
});

const FONTES = import.meta.glob<string>(
  [
    "/src/views/customer/**/*.{ts,tsx}",
    "/src/views/shared/**/*.{ts,tsx}",
    "/src/components/ui/custom/**/*.{ts,tsx}",
    "/src/components/desktop/**/*.{ts,tsx}",
    "/src/components/pwa/**/*.{ts,tsx}",
    "/src/App.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

describe("um só leitor de largura na casca da cliente (contrato C1, regra R8)", () => {
  it("a varredura não é vazia (senão o teste protegeria contra nada)", () => {
    expect(Object.keys(FONTES).length).toBeGreaterThan(20);
  });

  it("nenhum arquivo usa useMediaQuery( ou matchMedia( com min-width/max-width fora do gancho", () => {
    const problemas: string[] = [];

    for (const [caminhoAbsoluto, texto] of Object.entries(FONTES)) {
      const relativo = caminhoAbsoluto.replace(/^\/src\//, "src/");
      for (const achado of acharLeitoresDeLarguraForaDoGancho(texto)) {
        problemas.push(`${relativo}: ${achado}`);
      }
    }

    if (problemas.length > 0) {
      throw new Error(
        `Leitor de largura fora do gancho único useTelaDeComputador() (contrato C1, regra R8): ${problemas.join(
          "; ",
        )}. Use useTelaDeComputador() (em React) ou ehTelaDeComputador() (fora de React) em vez de ler matchMedia/useMediaQuery com min-width/max-width diretamente.`,
      );
    }
  });
});
