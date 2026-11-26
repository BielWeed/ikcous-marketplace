import path from "node:path";
import type { Plugin, Rollup } from "vite";
import { type ChunkParaOPrecache, arquivosDoPainel } from "./precacheSemPainel";

/**
 * O NÚCLEO do precache (plano "a primeira visita deixa de baixar o app
 * inteiro", 26/11/2026). Hoje o `install` do service worker baixa o app
 * inteiro (~140 arquivos) no primeiro acesso de TODO visitante, e cada arquivo
 * é um "CDN Request" da Vercel (no Hobby, 1 milhão no mês estourado pausa o
 * projeto e derruba todas as lojas). Na primeira instalação, o service worker
 * vai guardar só o que este arquivo marca com `nucleo: true` no manifesto; o
 * resto entra depois (ver o plano, lote B).
 *
 * O núcleo é o que a primeira tela e a volta sem internet precisam:
 *   - a entrada e tudo que ela importa ESTATICAMENTE (em cadeia);
 *   - a vitrine (`HomeView`), a página do produto (`ProductView`), o `Header`
 *     e o `BottomNav` — o App os carrega por `import()` — com TUDO que um
 *     toque neles puxa sem trocar de tela: imports estáticos e dinâmicos (o
 *     aviso de "adicionado ao carrinho", uma gaveta, uma animação), parando
 *     nas telas-rota (`ROTAS_DA_LOJA`) e no painel;
 *   - o CSS/arquivos de apoio de todos esses chunks;
 *   - a página offline e os ícones de coração e carrinho (dos avisos);
 *   - o que a página inicial pede fora de /assets/ (`silent-guardian.js`,
 *     `loading.css`).
 * Decisão do sócio (26/11/2026): se um pedaço puxado dentro da vitrine faltar
 * sem internet, o app recarrega NA vitrine; a TELA de outra rota (carrinho,
 * checkout) fica de fora. O que só a ENTRADA pede por `import()` (o lembrete
 * do carrinho, as animações de troca de tela) também fica de fora.
 *
 * As quatro telas se acham pelo MÓDULO, comparando o caminho absoluto (lista
 * fechada, como o `identityEntries` do vite.config.ts), não pelo nome do
 * arquivo: o `experimentalMinChunkSize` funde chunk pequeno num vizinho e o
 * nome final deixa de dizer quem está dentro, mas `moduleIds` continua
 * listando todos os módulos do chunk.
 *
 * Falha FECHADA, no molde do `precacheSemPainel`: se uma das quatro telas não
 * aparece no bundle (renomeada, movida), o build quebra no `generateBundle`;
 * se o filtro do manifesto roda sem a marcação (ordem dos hooks mudou, bundle
 * vazio) ou um arquivo público do núcleo sumiu do manifesto, o build também
 * quebra. Deixar passar faria o service worker guardar um núcleo sem a vitrine
 * (ou sem a página offline), em silêncio, com o build verde.
 */

/** As quatro telas do núcleo, relativas à raiz do repositório. Se um caminho
 * mudar, mude aqui junto — a comparação é pelo caminho absoluto. */
const MODULOS_DO_NUCLEO = [
  "src/views/customer/HomeView.tsx",
  "src/views/customer/ProductView.tsx",
  "src/components/ui/custom/Header.tsx",
  "src/components/ui/custom/BottomNav.tsx",
] as const;

/**
 * As telas-ROTA da loja (o `VIEW_COMPONENTS` do `src/App.tsx`), relativas à
 * raiz. São a fronteira do núcleo: um `import()` de dentro do núcleo que cai
 * numa delas é trocar de tela, e para ali. O painel para pela classificação do
 * portão (`arquivosDoPainel`), não por esta lista. O teste
 * `tests/front/precache-nucleo.test.ts` confere a lista contra o App.tsx.
 */
export const ROTAS_DA_LOJA: readonly string[] = [
  "src/views/customer/AboutStoreView.tsx",
  "src/views/customer/AccountSettingsView.tsx",
  "src/views/customer/AddressFormView.tsx",
  "src/views/customer/CartView.tsx",
  "src/views/customer/CheckoutView.tsx",
  "src/views/customer/FavoritesView.tsx",
  "src/views/customer/HomeView.tsx",
  "src/views/customer/NotificationsView.tsx",
  "src/views/customer/OrderDetailsView.tsx",
  "src/views/customer/OrderSuccessView.tsx",
  "src/views/customer/PoliticaDaLojaView.tsx",
  "src/views/customer/ProductView.tsx",
  "src/views/customer/ProfileView.tsx",
  "src/views/customer/SearchView.tsx",
  "src/views/customer/UserProfileView.tsx",
  "src/views/shared/AuthView.tsx",
  "src/views/admin/AdminLoginView.tsx",
];

/** Arquivos de `public/` que entram no núcleo, como aparecem no manifesto.
 * O `silent-guardian.js` e o `loading.css` a página inicial pede antes do
 * app (index.html): sem eles no núcleo, reabrir sem internet depois de UMA
 * visita abria a `/` guardada sem os dois (medido em navegador, 26/11/2026;
 * guarda em tests/porteiro-dois-hosts/precache-nucleo.test.ts). */
export const ARQUIVOS_PUBLICOS_DO_NUCLEO: readonly string[] = [
  "offline.html",
  "icons/heart-96x96.png",
  "icons/cart-96x96.png",
  "silent-guardian.js",
  "loading.css",
];

const comBarraNormal = (caminho: string) => caminho.replace(/\\/g, "/");
const semBarraNaFrente = (url: string) => url.replace(/^\/+/, "");

/** Caminho absoluto, com barra normal, de cada tela do núcleo. */
export function entradasDoNucleo(root: string): string[] {
  return MODULOS_DO_NUCLEO.map((relativo) =>
    comBarraNormal(path.resolve(root, relativo)),
  );
}

/** Caminho absoluto, com barra normal, de cada tela-rota da loja. */
export function rotasDaLoja(root: string): string[] {
  return ROTAS_DA_LOJA.map((relativo) =>
    comBarraNormal(path.resolve(root, relativo)),
  );
}

/**
 * Todo arquivo do bundle que é do núcleo, mais os arquivos de apoio (CSS,
 * endereços importados) de cada chunk que entra:
 *   - os chunks de ENTRADA e o fecho dos imports ESTÁTICOS deles (os dinâmicos
 *     da entrada são o app inteiro: cada tela, cada janela);
 *   - os chunks que contêm um dos módulos de `entradas` e o fecho dos imports
 *     estáticos E dinâmicos deles. Import estático entra sempre (sem ele o
 *     chunk não roda); import dinâmico para num chunk que contém uma das
 *     `rotas` (fora as próprias telas do núcleo) ou que é do painel.
 * Quebra (PRECACHE_NUCLEO) se não há entrada ou se um módulo não aparece.
 */
export function arquivosDoNucleo(
  chunks: readonly ChunkParaOPrecache[],
  entradas: readonly string[],
  rotas: readonly string[],
): Set<string> {
  const porArquivo = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const deEntrada = chunks.filter((chunk) => chunk.isEntry);
  if (deEntrada.length === 0)
    throw new Error(
      "PRECACHE_NUCLEO: o bundle não tem chunk de entrada; o núcleo do precache não pode ser montado.",
    );

  const procuradas = new Set(entradas.map(comBarraNormal));
  const outrasRotas = new Set(
    rotas.map(comBarraNormal).filter((rota) => !procuradas.has(rota)),
  );
  const achadas = new Set<string>();
  const telas: ChunkParaOPrecache[] = [];
  const fronteira = arquivosDoPainel(chunks);
  for (const chunk of chunks)
    for (const moduleId of chunk.moduleIds) {
      const id = comBarraNormal(moduleId);
      if (outrasRotas.has(id)) fronteira.add(chunk.fileName);
      if (!procuradas.has(id)) continue;
      achadas.add(id);
      telas.push(chunk);
    }
  const faltando = [...procuradas].filter((id) => !achadas.has(id));
  if (faltando.length > 0)
    throw new Error(
      `PRECACHE_NUCLEO: tela do núcleo fora do bundle: ${faltando.join(", ")}. Conferir os caminhos em scripts/precacheNucleo.ts (MODULOS_DO_NUCLEO).`,
    );

  const nucleo = new Set<string>();
  const percorrer = (
    raizes: readonly ChunkParaOPrecache[],
    seguirDinamicos: boolean,
  ) => {
    const visitados = new Set<string>();
    const fila = raizes.map((chunk) => chunk.fileName);
    while (fila.length > 0) {
      const arquivo = fila.pop() as string;
      if (visitados.has(arquivo)) continue;
      visitados.add(arquivo);
      nucleo.add(arquivo);
      const chunk = porArquivo.get(arquivo);
      if (!chunk) continue;
      for (const apoio of chunk.arquivosDeApoio) nucleo.add(apoio);
      for (const importado of chunk.imports) fila.push(importado);
      if (!seguirDinamicos) continue;
      for (const importado of chunk.dynamicImports)
        if (!fronteira.has(importado)) fila.push(importado);
    }
  };
  percorrer(deEntrada, false);
  percorrer(telas, true);
  return nucleo;
}

interface EntradaDoManifesto {
  url: string;
}

/**
 * Plugin de build + a função de manifesto que o Workbox chama
 * (`injectManifest.manifestTransforms`). O plugin calcula o núcleo quando o
 * Rollup entrega o bundle; a função põe `nucleo: true` nessas entradas, sem
 * mudar `url`, `revision` nem a ordem, e sem tirar nada.
 */
export function precacheNucleo(opcoes: { root: string }): {
  plugin: Plugin;
  marcarONucleo: <T extends EntradaDoManifesto>(
    entradas: T[],
  ) => { manifest: (T & { nucleo?: true })[]; warnings: string[] };
} {
  const doNucleo = new Set<string>();
  let marcou = false;

  const plugin: Plugin = {
    name: "precache-nucleo",
    apply: "build",
    generateBundle(_opcoes, bundle) {
      const chunks: ChunkParaOPrecache[] = Object.values(bundle)
        .filter((item): item is Rollup.OutputChunk => item.type === "chunk")
        .map((chunk) => ({
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
          isDynamicEntry: chunk.isDynamicEntry,
          moduleIds: chunk.moduleIds,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          arquivosDeApoio: [
            ...(chunk.viteMetadata?.importedCss ?? []),
            ...(chunk.viteMetadata?.importedAssets ?? []),
          ],
        }));
      doNucleo.clear();
      marcou = false;
      if (chunks.length === 0) return;
      for (const arquivo of arquivosDoNucleo(
        chunks,
        entradasDoNucleo(opcoes.root),
        rotasDaLoja(opcoes.root),
      ))
        doNucleo.add(arquivo);
      marcou = true;
    },
  };

  const marcarONucleo = <T extends EntradaDoManifesto>(entradas: T[]) => {
    if (!marcou)
      throw new Error(
        "PRECACHE_NUCLEO: o precache foi montado sem a marcação do núcleo do build. Conferir a ordem dos plugins em vite.config.ts (precacheNucleo antes do PWA).",
      );
    const urls = new Set(entradas.map((e) => semBarraNaFrente(e.url)));
    const faltando = ARQUIVOS_PUBLICOS_DO_NUCLEO.filter((a) => !urls.has(a));
    if (faltando.length > 0)
      throw new Error(
        `PRECACHE_NUCLEO: arquivo público do núcleo fora do manifesto: ${faltando.join(", ")}. Conferir public/ e ARQUIVOS_PUBLICOS_DO_NUCLEO em scripts/precacheNucleo.ts.`,
      );
    // JS/CSS do núcleo que o `globIgnores` ou o filtro do painel tirou do
    // manifesto: a primeira instalação guardaria um núcleo que não abre sem
    // internet. Fonte e imagem do bundle ficam de fora da cobrança (o
    // `globPatterns` decide quais tipos entram no precache).
    const foraDoManifesto = [...doNucleo].filter(
      (arquivo) => /\.(?:js|css)$/.test(arquivo) && !urls.has(arquivo),
    );
    if (foraDoManifesto.length > 0)
      throw new Error(
        `PRECACHE_NUCLEO: JS/CSS do núcleo fora do manifesto: ${foraDoManifesto.join(", ")}. Conferir o globIgnores do vite.config.ts e a classificação do painel (scripts/precacheSemPainel.ts).`,
      );
    const publicos = new Set(ARQUIVOS_PUBLICOS_DO_NUCLEO);
    return {
      manifest: entradas.map((entrada): T & { nucleo?: true } => {
        const url = semBarraNaFrente(entrada.url);
        return doNucleo.has(url) || publicos.has(url)
          ? { ...entrada, nucleo: true }
          : entrada;
      }),
      warnings: [] as string[],
    };
  };

  return { plugin, marcarONucleo };
}
