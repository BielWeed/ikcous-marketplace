/* eslint-disable security/detect-non-literal-fs-filename -- Só arquivos fixos do próprio repositório (src/App.tsx e ROTAS_DA_LOJA). */
// Plano "a primeira visita deixa de baixar o app inteiro" (26/11/2026), T2.
// Hoje o service worker baixa o app inteiro (~140 arquivos) no primeiro acesso
// de TODO visitante. O plano: na primeira instalação, só o NÚCLEO — a entrada e
// o que ela importa estaticamente; a vitrine (HomeView), a página do produto
// (ProductView), o Header e o BottomNav com TUDO que um toque neles puxa sem
// trocar de tela (imports estáticos E dinâmicos, parando nas rotas e no
// painel); o CSS de todos; a página offline e os ícones de coração e carrinho.
// Decisão do sócio (26/11/2026): se um pedaço puxado dentro da vitrine faltar
// sem internet, o app recarrega NA vitrine; a TELA de outra rota (carrinho,
// checkout) fica de fora.
//
// Este teste cobre a parte pura, com um bundle FALSO no molde de
// `precache-sem-painel.test.ts`: quais arquivos são do núcleo, e a marca
// `nucleo: true` que o filtro do manifesto põe sem mexer em `url`/`revision`.
// Falha FECHADA: sem classificação, ou com uma das quatro telas do núcleo
// sumida do bundle (renomeada, movida), o build quebra — deixar passar faria o
// service worker de amanhã guardar um núcleo sem a vitrine, em silêncio.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARQUIVOS_PUBLICOS_DO_NUCLEO,
  ROTAS_DA_LOJA,
  arquivosDoNucleo,
  entradasDoNucleo,
  precacheNucleo,
  rotasDaLoja,
} from "../../scripts/precacheNucleo";
import type { ChunkParaOPrecache } from "../../scripts/precacheSemPainel";

// Raiz absoluta do repositório falso, no formato do sistema (no Windows ganha
// a letra do disco); o módulo do Rollup vem sempre com barra normal.
const RAIZ = path.resolve("/repo");
const modulo = (relativo: string) =>
  path.resolve(RAIZ, relativo).replace(/\\/g, "/");

const HOME = modulo("src/views/customer/HomeView.tsx");
const PRODUTO = modulo("src/views/customer/ProductView.tsx");
const HEADER = modulo("src/components/ui/custom/Header.tsx");
const BOTTOM_NAV = modulo("src/components/ui/custom/BottomNav.tsx");

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

// A loja: entrada -> (estático) vendor-inicio -> (estático) runtime;
// (dinâmico) as quatro do núcleo, o carrinho, o lembrete do carrinho e o
// painel. A vitrine e o produto dividem o card (estático), que puxa o
// formatador de preço (estático, um nível abaixo). Header e BottomNav dividem o
// framer-motion. De dentro da vitrine, um toque abre o aviso "adicionado ao
// carrinho" (dinâmico, não é rota: ENTRA) ou vai ao carrinho (rota: NÃO entra);
// do aviso, "finalizar" leva ao checkout (rota: NÃO entra, nem o que ela puxa).
function bundleDeExemplo(): ChunkParaOPrecache[] {
  return [
    chunk({
      fileName: "assets/index-h1.js",
      isEntry: true,
      moduleIds: [modulo("src/main.tsx"), modulo("src/App.tsx")],
      imports: ["assets/vendor-inicio-h2.js"],
      dynamicImports: [
        "assets/HomeView-h3.js",
        "assets/ProductView-h4.js",
        "assets/Header-h5.js",
        "assets/BottomNav-h6.js",
        "assets/CartView-h7.js",
        "assets/AdminArea-h8.js",
        "assets/CartReminder-h21.js",
      ],
      arquivosDeApoio: ["assets/index-h1.css", "assets/inter-h9.woff2"],
    }),
    chunk({
      fileName: "assets/vendor-inicio-h2.js",
      imports: ["assets/runtime-h10.js"],
    }),
    chunk({ fileName: "assets/runtime-h10.js" }),
    chunk({
      fileName: "assets/HomeView-h3.js",
      isDynamicEntry: true,
      moduleIds: [HOME],
      imports: ["assets/card-produto-h11.js", "assets/vendor-inicio-h2.js"],
      dynamicImports: ["assets/AvisoCarrinho-h12.js", "assets/CartView-h7.js"],
      arquivosDeApoio: ["assets/HomeView-h3.css"],
    }),
    chunk({
      fileName: "assets/ProductView-h4.js",
      isDynamicEntry: true,
      moduleIds: [PRODUTO, modulo("src/components/product/Galeria.tsx")],
      imports: ["assets/card-produto-h11.js"],
      dynamicImports: ["assets/Zoom-h13.js"],
      arquivosDeApoio: ["assets/ProductView-h4.css", "assets/selo-h14.svg"],
    }),
    // O Header se fundiu com um vizinho (experimentalMinChunkSize): a fachada
    // some, mas o módulo continua na lista de módulos do chunk. A lupa leva à
    // busca (rota) e o atalho do lojista ao painel: nenhum dos dois entra.
    chunk({
      fileName: "assets/Header-h5.js",
      isDynamicEntry: true,
      moduleIds: [modulo("src/components/ui/custom/Busca.tsx"), HEADER],
      imports: ["assets/framer-h15.js"],
      dynamicImports: ["assets/SearchView-h22.js", "assets/AdminArea-h8.js"],
    }),
    chunk({
      fileName: "assets/BottomNav-h6.js",
      isDynamicEntry: true,
      moduleIds: [BOTTOM_NAV],
      imports: ["assets/framer-h15.js"],
      arquivosDeApoio: ["assets/BottomNav-h6.css"],
    }),
    chunk({
      fileName: "assets/card-produto-h11.js",
      imports: ["assets/preco-h16.js"],
      arquivosDeApoio: ["assets/card-produto-h11.css"],
    }),
    chunk({ fileName: "assets/preco-h16.js" }),
    chunk({ fileName: "assets/framer-h15.js" }),
    chunk({
      fileName: "assets/AvisoCarrinho-h12.js",
      isDynamicEntry: true,
      moduleIds: [modulo("src/components/cart/AvisoCarrinho.tsx")],
      imports: ["assets/confete-h18.js"],
      dynamicImports: ["assets/CheckoutView-h19.js"],
      arquivosDeApoio: ["assets/AvisoCarrinho-h12.css"],
    }),
    chunk({ fileName: "assets/confete-h18.js" }),
    chunk({
      fileName: "assets/Zoom-h13.js",
      isDynamicEntry: true,
      moduleIds: [modulo("src/components/product/Zoom.tsx")],
    }),
    chunk({
      fileName: "assets/CartView-h7.js",
      isDynamicEntry: true,
      moduleIds: [modulo("src/views/customer/CartView.tsx")],
      imports: ["assets/card-produto-h11.js"],
      arquivosDeApoio: ["assets/CartView-h7.css"],
    }),
    chunk({
      fileName: "assets/CheckoutView-h19.js",
      isDynamicEntry: true,
      moduleIds: [modulo("src/views/customer/CheckoutView.tsx")],
      imports: ["assets/pagamento-h20.js"],
    }),
    chunk({ fileName: "assets/pagamento-h20.js" }),
    chunk({
      fileName: "assets/SearchView-h22.js",
      isDynamicEntry: true,
      moduleIds: [modulo("src/views/customer/SearchView.tsx")],
    }),
    chunk({
      fileName: "assets/AdminArea-h8.js",
      isDynamicEntry: true,
      moduleIds: [modulo("src/components/layouts/AdminArea.tsx")],
      dynamicImports: ["assets/relatorio-h23.js"],
    }),
    // Peça do painel sem nome de painel: só o grafo a denuncia.
    chunk({ fileName: "assets/relatorio-h23.js", isDynamicEntry: true }),
    // Lembrete do carrinho: o App o pede, não a vitrine. Fica fora do núcleo.
    chunk({
      fileName: "assets/CartReminder-h21.js",
      isDynamicEntry: true,
      moduleIds: [modulo("src/components/ui/custom/CartReminder.tsx")],
    }),
  ];
}

const NUCLEO_ESPERADO = [
  "assets/index-h1.js",
  "assets/index-h1.css",
  "assets/inter-h9.woff2",
  "assets/vendor-inicio-h2.js",
  "assets/runtime-h10.js",
  "assets/HomeView-h3.js",
  "assets/HomeView-h3.css",
  "assets/ProductView-h4.js",
  "assets/ProductView-h4.css",
  "assets/selo-h14.svg",
  "assets/Header-h5.js",
  "assets/BottomNav-h6.js",
  "assets/BottomNav-h6.css",
  "assets/card-produto-h11.js",
  "assets/card-produto-h11.css",
  "assets/preco-h16.js",
  "assets/framer-h15.js",
  "assets/AvisoCarrinho-h12.js",
  "assets/AvisoCarrinho-h12.css",
  "assets/confete-h18.js",
  "assets/Zoom-h13.js",
];

const calcular = (bundle: ChunkParaOPrecache[]) =>
  arquivosDoNucleo(bundle, entradasDoNucleo(RAIZ), rotasDaLoja(RAIZ));

describe("entradasDoNucleo", () => {
  it("são as quatro telas do núcleo, em caminho absoluto com barra normal", () => {
    expect(entradasDoNucleo(RAIZ)).toEqual([HOME, PRODUTO, HEADER, BOTTOM_NAV]);
  });
});

describe("ROTAS_DA_LOJA", () => {
  // A fronteira do núcleo é a lista fechada de telas-rota. Rota nova no App
  // sem entrada aqui entraria no núcleo se a vitrine a pedisse por import():
  // este teste obriga a lista a andar junto com o roteador manual.
  const raizDoRepo = path.resolve(import.meta.dirname, "../..");
  const lerFonte = (relativo: string) =>
    fs.readFileSync(path.join(raizDoRepo, relativo), "utf8");

  it("toda tela que o App.tsx carrega por import() de src/views/ está na lista", () => {
    const telas = [
      ...lerFonte("src/App.tsx").matchAll(/import\("@\/views\/([^"]+)"\)/g),
    ].map((m) => `src/views/${m[1]}.tsx`);
    expect(telas.length).toBeGreaterThan(10);
    for (const tela of telas) expect(ROTAS_DA_LOJA).toContain(tela);
  });

  it("todo caminho da lista existe no repositório", () => {
    for (const rota of ROTAS_DA_LOJA)
      expect(fs.existsSync(path.join(raizDoRepo, rota)), rota).toBe(true);
  });
});

describe("arquivosDoNucleo", () => {
  it("entrada + estáticos dela + as quatro telas com estáticos, dinâmicos que não são rota e CSS", () => {
    expect([...calcular(bundleDeExemplo())].sort()).toEqual(
      [...NUCLEO_ESPERADO].sort(),
    );
  });

  it("um toque na vitrine que abre aviso (não rota) ENTRA; o carrinho como tela NÃO", () => {
    const nucleo = calcular(bundleDeExemplo());
    expect(nucleo).toContain("assets/AvisoCarrinho-h12.js");
    expect(nucleo).toContain("assets/AvisoCarrinho-h12.css");
    expect(nucleo).not.toContain("assets/CartView-h7.js");
    expect(nucleo).not.toContain("assets/CartView-h7.css");
  });

  it("rota alcançada de dentro de um pedaço do núcleo para ali, com o que ela puxa", () => {
    const nucleo = calcular(bundleDeExemplo());
    expect(nucleo).not.toContain("assets/CheckoutView-h19.js");
    expect(nucleo).not.toContain("assets/pagamento-h20.js");
    expect(nucleo).not.toContain("assets/SearchView-h22.js");
  });

  it("NÃO inclui o painel, nem a peça dele sem nome de painel", () => {
    const nucleo = calcular(bundleDeExemplo());
    expect(nucleo).not.toContain("assets/AdminArea-h8.js");
    expect(nucleo).not.toContain("assets/relatorio-h23.js");
  });

  it("import dinâmico que só a ENTRADA faz (lembrete do carrinho) fica de fora", () => {
    expect(calcular(bundleDeExemplo())).not.toContain(
      "assets/CartReminder-h21.js",
    );
  });

  it("import ESTÁTICO de uma tela do núcleo entra mesmo se o chunk tem rota dentro", () => {
    // Se o Rollup juntou o carrinho num chunk que a vitrine importa
    // estaticamente, a vitrine não roda sem ele: entra.
    const bundle = bundleDeExemplo().map((c) =>
      c.fileName === "assets/HomeView-h3.js"
        ? { ...c, imports: [...c.imports, "assets/CartView-h7.js"] }
        : c,
    );
    expect(calcular(bundle)).toContain("assets/CartView-h7.js");
  });

  it("acha a tela pelo módulo mesmo quando o chunk foi fundido com outro", () => {
    expect(calcular(bundleDeExemplo())).toContain("assets/Header-h5.js");
  });

  it("compara por caminho ABSOLUTO: o mesmo nome em outra pasta não serve", () => {
    // Um HomeView.tsx de outra raiz (pacote, cópia) não é a vitrine.
    const bundle = bundleDeExemplo().map((c) =>
      c.fileName === "assets/HomeView-h3.js"
        ? { ...c, moduleIds: ["/outra/src/views/customer/HomeView.tsx"] }
        : c,
    );
    expect(() => calcular(bundle)).toThrow(/PRECACHE_NUCLEO.*HomeView/);
  });

  it("rota comparada por caminho ABSOLUTO: CartView de outra pasta não é rota", () => {
    const bundle = bundleDeExemplo().map((c) =>
      c.fileName === "assets/CartView-h7.js"
        ? { ...c, moduleIds: ["/outra/src/views/customer/CartView.tsx"] }
        : c,
    );
    expect(calcular(bundle)).toContain("assets/CartView-h7.js");
  });

  it("aceita o módulo com barra invertida (Windows) do lado do bundle", () => {
    const bundle = bundleDeExemplo().map((c) =>
      c.fileName === "assets/BottomNav-h6.js"
        ? { ...c, moduleIds: [BOTTOM_NAV.replace(/\//g, "\\")] }
        : c,
    );
    expect(calcular(bundle)).toContain("assets/BottomNav-h6.js");
  });

  it.each([
    ["HomeView", "assets/HomeView-h3.js"],
    ["ProductView", "assets/ProductView-h4.js"],
    ["Header", "assets/Header-h5.js"],
    ["BottomNav", "assets/BottomNav-h6.js"],
  ])("falha FECHADA se a tela %s sumiu do bundle", (nome, arquivo) => {
    const bundle = bundleDeExemplo().filter((c) => c.fileName !== arquivo);
    let erro: unknown;
    try {
      calcular(bundle);
    } catch (e) {
      erro = e;
    }
    expect(String(erro)).toMatch(/PRECACHE_NUCLEO/);
    expect(String(erro)).toContain(`${nome}.tsx`);
  });

  it("falha FECHADA se o bundle não tem entrada", () => {
    const bundle = bundleDeExemplo().map((c) => ({ ...c, isEntry: false }));
    expect(() => calcular(bundle)).toThrow(/PRECACHE_NUCLEO/);
  });

  it("import em ciclo (estático ou dinâmico) não trava a conta", () => {
    const bundle = bundleDeExemplo().map((c) => {
      if (c.fileName === "assets/runtime-h10.js")
        return { ...c, imports: ["assets/vendor-inicio-h2.js"] };
      if (c.fileName === "assets/AvisoCarrinho-h12.js")
        return { ...c, dynamicImports: ["assets/HomeView-h3.js"] };
      return c;
    });
    const nucleo = calcular(bundle);
    expect(nucleo).toContain("assets/runtime-h10.js");
    expect(nucleo).toContain("assets/AvisoCarrinho-h12.js");
  });
});

describe("precacheNucleo", () => {
  type Gerar = (opcoes: unknown, bundle: Record<string, unknown>) => void;

  function paraOBundle(chunks: ChunkParaOPrecache[]) {
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
    bundle["assets/foto-h17.png"] = {
      type: "asset",
      fileName: "assets/foto-h17.png",
    };
    return bundle;
  }

  function rodarOPlugin(chunks: ChunkParaOPrecache[]) {
    const { plugin, marcarONucleo } = precacheNucleo({ root: RAIZ });
    (plugin.generateBundle as unknown as Gerar).call(
      {},
      {},
      paraOBundle(chunks),
    );
    return marcarONucleo;
  }

  const entradas = [
    { url: "index.html", revision: "a" },
    { url: "offline.html", revision: "b" },
    { url: "icons/heart-96x96.png", revision: "c" },
    { url: "icons/cart-96x96.png", revision: "d" },
    { url: "icons/badge-96x96.png", revision: "e" },
    { url: "logos/transportadoras/correios.svg", revision: "f" },
    { url: "assets/index-h1.js", revision: null },
    { url: "assets/index-h1.css", revision: null },
    { url: "assets/HomeView-h3.js", revision: null },
    { url: "assets/CheckoutView-h19.js", revision: null },
    { url: "assets/CartView-h7.js", revision: null },
    { url: "assets/framer-h15.js", revision: null },
  ];

  it("os arquivos públicos do núcleo são a página offline e os ícones de coração e carrinho", () => {
    expect([...ARQUIVOS_PUBLICOS_DO_NUCLEO]).toEqual([
      "offline.html",
      "icons/heart-96x96.png",
      "icons/cart-96x96.png",
    ]);
  });

  it("marca `nucleo: true` só no núcleo, sem tirar nada e na mesma ordem", () => {
    const { manifest, warnings } = rodarOPlugin(bundleDeExemplo())(entradas);
    expect(manifest.map((e) => e.url)).toEqual(entradas.map((e) => e.url));
    expect(manifest.filter((e) => e.nucleo === true).map((e) => e.url)).toEqual(
      [
        "offline.html",
        "icons/heart-96x96.png",
        "icons/cart-96x96.png",
        "assets/index-h1.js",
        "assets/index-h1.css",
        "assets/HomeView-h3.js",
        "assets/framer-h15.js",
      ],
    );
    expect(warnings).toEqual([]);
  });

  it("quem não é núcleo sai IGUAL (sem o campo `nucleo`)", () => {
    const { manifest } = rodarOPlugin(bundleDeExemplo())(entradas);
    const checkout = manifest.find(
      (e) => e.url === "assets/CheckoutView-h19.js",
    );
    expect(checkout).toEqual({
      url: "assets/CheckoutView-h19.js",
      revision: null,
    });
    expect(checkout).not.toHaveProperty("nucleo");
  });

  it("não muda `url` nem `revision` (nem outros campos) de quem é marcado", () => {
    const { manifest } = rodarOPlugin(bundleDeExemplo())([
      ...entradas,
      { url: "/assets/HomeView-h3.css", revision: "zz", size: 12 },
    ]);
    expect(manifest.find((e) => e.url === "offline.html")).toEqual({
      url: "offline.html",
      revision: "b",
      nucleo: true,
    });
    expect(manifest.at(-1)).toEqual({
      url: "/assets/HomeView-h3.css",
      revision: "zz",
      size: 12,
      nucleo: true,
    });
  });

  it("não altera as entradas que recebeu (devolve objetos novos)", () => {
    const copia = entradas.map((e) => ({ ...e }));
    rodarOPlugin(bundleDeExemplo())(copia);
    expect(copia).toEqual(entradas);
  });

  it("falha FECHADA se um arquivo público do núcleo não está no manifesto", () => {
    // Ícone renomeado em public/: sem a falha, o núcleo perderia o ícone em
    // silêncio.
    const marcar = rodarOPlugin(bundleDeExemplo());
    expect(() =>
      marcar(entradas.filter((e) => e.url !== "icons/cart-96x96.png")),
    ).toThrow(/PRECACHE_NUCLEO.*cart-96x96/);
  });

  it("falha FECHADA se o filtro rodar antes de o núcleo ser marcado no build", () => {
    const { marcarONucleo } = precacheNucleo({ root: RAIZ });
    expect(() => marcarONucleo(entradas)).toThrow(/PRECACHE_NUCLEO/);
  });

  it("falha FECHADA se a classificação veio sem nenhum chunk", () => {
    const { plugin, marcarONucleo } = precacheNucleo({ root: RAIZ });
    (plugin.generateBundle as unknown as Gerar).call({}, {}, {});
    expect(() => marcarONucleo(entradas)).toThrow(/PRECACHE_NUCLEO/);
  });

  it("o build QUEBRA se uma tela do núcleo sumiu do bundle", () => {
    const { plugin } = precacheNucleo({ root: RAIZ });
    const semHeader = bundleDeExemplo().filter(
      (c) => c.fileName !== "assets/Header-h5.js",
    );
    expect(() =>
      (plugin.generateBundle as unknown as Gerar).call(
        {},
        {},
        paraOBundle(semHeader),
      ),
    ).toThrow(/PRECACHE_NUCLEO.*Header/);
  });

  it("um build novo sem chunk apaga a marcação do build anterior", () => {
    const { plugin, marcarONucleo } = precacheNucleo({ root: RAIZ });
    const gerar = plugin.generateBundle as unknown as Gerar;
    gerar.call({}, {}, paraOBundle(bundleDeExemplo()));
    gerar.call({}, {}, {});
    expect(() => marcarONucleo(entradas)).toThrow(/PRECACHE_NUCLEO/);
  });
});
