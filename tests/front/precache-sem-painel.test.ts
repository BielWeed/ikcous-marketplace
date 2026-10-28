// Lote 252 (28/10/2026): o service worker não baixa mais, no primeiro acesso de
// TODO visitante, as peças do painel da lojista (o leitor de código de barras
// do Balcão sozinho era 406 kB, 40% do precache). Decisão do dono: o Balcão não
// precisa funcionar sem internet — o painel vai pela rede.
//
// Este teste cobre a parte pura, com um bundle FALSO (o build de verdade é caro
// demais para cada `npm run test:front`): quais arquivos são do painel e como o
// filtro do manifesto se comporta. A prova contra o build real mora em
// `tests/porteiro-dois-hosts/precache-sem-painel.test.ts`, que lê o `sw.js` e o
// `dist-test.json` depois do `npm run build`.
//
// A regra segue a CLASSIFICAÇÃO do portão de tamanho (`classificarBundle`), não
// uma lista de nomes: peça nova do painel, com nome comum, sai do precache
// sozinha. É isso que o caso "NOVA com nome comum" fixa.
import { describe, expect, it } from "vitest";
import {
  type ChunkParaOPrecache,
  arquivosDoPainel,
  precacheSemPainel,
} from "../../scripts/precacheSemPainel";

function chunk(
  parcial: Partial<ChunkParaOPrecache> & { fileName: string },
): ChunkParaOPrecache {
  return {
    isEntry: false,
    isDynamicEntry: false,
    moduleIds: [],
    imports: [],
    dynamicImports: [],
    arquivosDeApoio: [],
    ...parcial,
  };
}

// A loja: entrada -> vitrine; a fronteira do painel (AdminArea.tsx) só é
// alcançada depois do `is_admin`. O resto do painel pendura nela.
function bundleDeExemplo(): ChunkParaOPrecache[] {
  return [
    chunk({
      fileName: "assets/index-h1.js",
      isEntry: true,
      imports: ["assets/vendor-inicio-h2.js"],
      dynamicImports: [
        "assets/HomeView-h3.js",
        "assets/AdminArea-h4.js",
        "assets/AdminLoginView-h5.js",
      ],
      arquivosDeApoio: ["assets/index-h1.css", "assets/inter-h9.woff2"],
    }),
    chunk({ fileName: "assets/vendor-inicio-h2.js" }),
    chunk({
      fileName: "assets/HomeView-h3.js",
      isDynamicEntry: true,
      moduleIds: ["/repo/src/views/customer/HomeView.tsx"],
      imports: ["assets/vendor-inicio-h2.js"],
      arquivosDeApoio: [
        "assets/HomeView-h3.css",
        "assets/compartilhado-h8.css",
      ],
    }),
    chunk({
      fileName: "assets/AdminLoginView-h5.js",
      isDynamicEntry: true,
      moduleIds: ["/repo/src/views/admin/AdminLoginView.tsx"],
    }),
    // A fronteira: o portão a reconhece pelo módulo AdminArea.tsx.
    chunk({
      fileName: "assets/AdminArea-h4.js",
      isDynamicEntry: true,
      moduleIds: ["/repo/src/components/layouts/AdminArea.tsx"],
      imports: ["assets/painel-ui-h6.js", "assets/vendor-charts-h7.js"],
      dynamicImports: [
        "assets/PdvBalcao-h10.js",
        "assets/relatorio-novo-h11.js",
      ],
      arquivosDeApoio: [
        "assets/AdminArea-h4.css",
        "assets/compartilhado-h8.css",
      ],
    }),
    chunk({ fileName: "assets/painel-ui-h6.js" }),
    chunk({ fileName: "assets/vendor-charts-h7.js" }),
    chunk({
      fileName: "assets/PdvBalcao-h10.js",
      isDynamicEntry: true,
      moduleIds: ["/repo/src/views/admin/AdminPdvView.tsx"],
      dynamicImports: ["assets/fallback-zxing-h12.js"],
    }),
    // Peça NOVA do painel, nome comum, sem "Admin" no nome: só o grafo a denuncia.
    chunk({
      fileName: "assets/relatorio-novo-h11.js",
      arquivosDeApoio: ["assets/relatorio-novo-h11.css"],
    }),
    chunk({
      fileName: "assets/fallback-zxing-h12.js",
      imports: ["assets/leitor-zxing-h13.js"],
      arquivosDeApoio: ["assets/zxing_reader-h14.wasm"],
    }),
    // O leitor: o portão não o põe em lista nenhuma (orçamento próprio).
    chunk({ fileName: "assets/leitor-zxing-h13.js" }),
  ];
}

describe("arquivosDoPainel", () => {
  it("devolve as peças do painel, inclusive a NOVA com nome comum", () => {
    const painel = arquivosDoPainel(bundleDeExemplo());
    for (const esperado of [
      "assets/AdminArea-h4.js",
      "assets/painel-ui-h6.js",
      "assets/vendor-charts-h7.js",
      "assets/PdvBalcao-h10.js",
      "assets/relatorio-novo-h11.js",
      "assets/fallback-zxing-h12.js",
    ])
      expect(painel).toContain(esperado);
  });

  it("inclui o leitor de código de barras (JS e .wasm), que o portão deixa fora das duas listas", () => {
    const painel = arquivosDoPainel(bundleDeExemplo());
    expect(painel).toContain("assets/leitor-zxing-h13.js");
    expect(painel).toContain("assets/zxing_reader-h14.wasm");
  });

  it("inclui o CSS que só uma peça do painel usa", () => {
    const painel = arquivosDoPainel(bundleDeExemplo());
    expect(painel).toContain("assets/AdminArea-h4.css");
    expect(painel).toContain("assets/relatorio-novo-h11.css");
  });

  it("NÃO inclui nada da loja: vitrine, entrada, fonte, login público", () => {
    const painel = arquivosDoPainel(bundleDeExemplo());
    for (const daLoja of [
      "assets/index-h1.js",
      "assets/vendor-inicio-h2.js",
      "assets/HomeView-h3.js",
      "assets/AdminLoginView-h5.js",
      "assets/index-h1.css",
      "assets/HomeView-h3.css",
      "assets/inter-h9.woff2",
    ])
      expect(painel).not.toContain(daLoja);
  });

  it("CSS usado pela loja E pelo painel fica no precache (a loja precisa dele)", () => {
    expect(arquivosDoPainel(bundleDeExemplo())).not.toContain(
      "assets/compartilhado-h8.css",
    );
  });

  it("peça que o portão não classifica mas a LOJA importa fica no precache", () => {
    // Hipótese: um dia a vitrine passa a importar o chunk do leitor. Aí ele não
    // é mais "só do painel", e tirá-lo do precache quebraria a loja offline.
    const bundle = bundleDeExemplo().map((c) =>
      c.fileName === "assets/HomeView-h3.js"
        ? { ...c, dynamicImports: ["assets/leitor-zxing-h13.js"] }
        : c,
    );
    expect(arquivosDoPainel(bundle)).not.toContain(
      "assets/leitor-zxing-h13.js",
    );
  });

  it("bundle sem painel nenhum não tira nada", () => {
    const soLoja = bundleDeExemplo().filter((c) =>
      [
        "assets/index-h1.js",
        "assets/vendor-inicio-h2.js",
        "assets/HomeView-h3.js",
      ].includes(c.fileName),
    );
    expect(arquivosDoPainel(soLoja).size).toBe(0);
  });
});

describe("precacheSemPainel", () => {
  type Gerar = (opcoes: unknown, bundle: Record<string, unknown>) => void;

  function rodarOPlugin(chunks: ChunkParaOPrecache[]) {
    const { plugin, tirarOPainel } = precacheSemPainel();
    const bundle: Record<string, unknown> = {};
    for (const c of chunks)
      bundle[c.fileName] = {
        type: "chunk",
        ...c,
        viteMetadata: {
          importedCss: new Set(
            c.arquivosDeApoio.filter((a) => a.endsWith(".css")),
          ),
          importedAssets: new Set(
            c.arquivosDeApoio.filter((a) => !a.endsWith(".css")),
          ),
        },
      };
    bundle["assets/foto-h15.png"] = {
      type: "asset",
      fileName: "assets/foto-h15.png",
    };
    (plugin.generateBundle as unknown as Gerar).call({}, {}, bundle);
    return tirarOPainel;
  }

  const entradas = [
    { url: "index.html", revision: "a" },
    { url: "assets/index-h1.js", revision: null },
    { url: "assets/HomeView-h3.js", revision: null },
    { url: "assets/inter-h9.woff2", revision: null },
    { url: "assets/compartilhado-h8.css", revision: null },
    { url: "assets/AdminArea-h4.css", revision: null },
    { url: "assets/vendor-charts-h7.js", revision: null },
    { url: "assets/relatorio-novo-h11.js", revision: null },
    { url: "assets/zxing_reader-h14.wasm", revision: null },
    { url: "assets/leitor-zxing-h13.js", revision: null },
  ];

  it("tira do manifesto só o que é do painel e devolve o resto na mesma ordem", () => {
    const tirarOPainel = rodarOPlugin(bundleDeExemplo());
    const { manifest, warnings } = tirarOPainel(entradas);
    expect(manifest.map((e) => e.url)).toEqual([
      "index.html",
      "assets/index-h1.js",
      "assets/HomeView-h3.js",
      "assets/inter-h9.woff2",
      "assets/compartilhado-h8.css",
    ]);
    expect(warnings).toEqual([]);
  });

  it("não perde os outros campos da entrada (revisão e tamanho seguem)", () => {
    const tirarOPainel = rodarOPlugin(bundleDeExemplo());
    const { manifest } = tirarOPainel([
      { url: "index.html", revision: "abc", size: 12 },
    ]);
    expect(manifest).toEqual([
      { url: "index.html", revision: "abc", size: 12 },
    ]);
  });

  it("aceita a URL com barra na frente", () => {
    const tirarOPainel = rodarOPlugin(bundleDeExemplo());
    const { manifest } = tirarOPainel([
      { url: "/assets/vendor-charts-h7.js" },
      { url: "/assets/HomeView-h3.js" },
    ]);
    expect(manifest.map((e) => e.url)).toEqual(["/assets/HomeView-h3.js"]);
  });

  it("falha FECHADO se o filtro rodar antes de o portão classificar o build", () => {
    // Sem classificação o filtro não sabe o que é painel. Deixar tudo passar
    // reabriria o precache de 593 kB em silêncio; melhor o build quebrar.
    const { tirarOPainel } = precacheSemPainel();
    expect(() => tirarOPainel(entradas)).toThrow(/PRECACHE_PAINEL/);
  });

  it("falha FECHADO se a classificação veio sem nenhum chunk", () => {
    const { plugin, tirarOPainel } = precacheSemPainel();
    (plugin.generateBundle as unknown as Gerar).call({}, {}, {});
    expect(() => tirarOPainel(entradas)).toThrow(/PRECACHE_PAINEL/);
  });
});
