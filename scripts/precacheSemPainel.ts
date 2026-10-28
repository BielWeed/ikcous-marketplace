import type { Plugin, Rollup } from "vite";
import { classificarBundle } from "./portaoDividido";
import type { ChunkParaClassificar } from "./portaoDividido";

/**
 * O precache do service worker não leva o painel da lojista (lote 252,
 * 28/10/2026). Antes, o `install` baixava no primeiro acesso de TODO visitante
 * as peças do painel junto com a loja: o leitor de código de barras do Balcão
 * sozinho (`zxing_reader.wasm`) era 406 kB, e o conjunto 593 kB — 40% do
 * precache, em toda loja, para quem só compra. Decisão do dono: o Balcão não
 * precisa funcionar sem internet, então o painel vai pela rede (e, depois da
 * primeira vez, pelo cache que o `fetch` do `sw.ts` já faz por arquivo).
 *
 * Quem diz o que é "painel" é o MESMO critério do portão de tamanho
 * (`classificarBundle`, em `scripts/portaoDividido.ts`): o grafo real do Rollup,
 * nunca o nome do arquivo. Uma peça nova do painel, com nome comum, sai do
 * precache sozinha; uma lista de nomes (`globIgnores`) envelheceria na primeira
 * peça nova. O plugin chama a função pura do portão sobre o mesmo bundle, no
 * `generateBundle` — antes de o PWA montar o manifesto, no `closeBundle`.
 *
 * Além do JS, saem os arquivos que existem POR CAUSA de peça do painel: o CSS
 * dela e o que ela importa como endereço (o `.wasm` do leitor). Arquivo que a
 * loja também usa (CSS compartilhado, fonte) fica: só sai o que TODOS os donos
 * têm como painel.
 */

/** O que a classificação usa, mais os arquivos que o Vite emite por causa do chunk. */
export interface ChunkParaOPrecache extends ChunkParaClassificar {
  /** CSS e arquivos importados como endereço (`?url`, ex.: `.wasm`) que o Vite
   * emitiu por causa deste chunk — caminhos relativos à saída, como `fileName`. */
  readonly arquivosDeApoio: readonly string[];
}

/**
 * Todo arquivo do bundle que é só do painel: o que o portão classifica como
 * `painel`; os chunks que ele deixa de fora das duas listas (o `leitor-zxing-*`,
 * orçamento próprio) enquanto a loja não os importa; e o CSS/arquivo de apoio
 * cujos donos são todos desses.
 */
export function arquivosDoPainel(
  chunks: readonly ChunkParaOPrecache[],
): Set<string> {
  const { cliente, painel } = classificarBundle(chunks);
  const doPainel = new Set(painel);

  // O portão não classifica o leitor (tem teto próprio). Para o precache ele só
  // fica de fora se NENHUM chunk da loja o importa.
  const daLoja = new Set(cliente);
  const classificados = new Set([...cliente, ...painel]);
  const importadosPelaLoja = new Set<string>();
  for (const chunk of chunks) {
    if (!daLoja.has(chunk.fileName)) continue;
    for (const alvo of [...chunk.imports, ...chunk.dynamicImports])
      importadosPelaLoja.add(alvo);
  }
  for (const chunk of chunks) {
    if (classificados.has(chunk.fileName)) continue;
    if (!importadosPelaLoja.has(chunk.fileName)) doPainel.add(chunk.fileName);
  }

  const donos = new Map<string, string[]>();
  for (const chunk of chunks)
    for (const arquivo of chunk.arquivosDeApoio) {
      const lista = donos.get(arquivo) ?? [];
      lista.push(chunk.fileName);
      donos.set(arquivo, lista);
    }
  for (const [arquivo, quem] of donos)
    if (quem.every((dono) => doPainel.has(dono))) doPainel.add(arquivo);

  return doPainel;
}

interface EntradaDoManifesto {
  url: string;
}

/**
 * Plugin de build + a função de manifesto que o Workbox chama
 * (`injectManifest.manifestTransforms`). O plugin guarda o que é do painel
 * quando o Rollup entrega o bundle; a função tira isso do manifesto.
 *
 * Falha FECHADO: se o filtro roda sem classificação (ordem dos hooks mudou, o
 * bundle veio vazio), quebra o build em vez de deixar tudo passar — deixar
 * passar reabriria os 593 kB em silêncio, e o build seguiria verde.
 */
export function precacheSemPainel(): {
  plugin: Plugin;
  tirarOPainel: <T extends EntradaDoManifesto>(
    entradas: T[],
  ) => { manifest: T[]; warnings: string[] };
} {
  const doPainel = new Set<string>();
  let classificou = false;

  const plugin: Plugin = {
    name: "precache-sem-painel",
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
      doPainel.clear();
      for (const arquivo of arquivosDoPainel(chunks)) doPainel.add(arquivo);
      classificou = chunks.length > 0;
    },
  };

  const tirarOPainel = <T extends EntradaDoManifesto>(entradas: T[]) => {
    if (!classificou)
      throw new Error(
        "PRECACHE_PAINEL: o precache foi montado sem a classificação cliente/painel do build. Conferir a ordem dos plugins em vite.config.ts (precacheSemPainel antes do PWA).",
      );
    return {
      manifest: entradas.filter(
        (entrada) => !doPainel.has(entrada.url.replace(/^\/+/, "")),
      ),
      warnings: [] as string[],
    };
  };

  return { plugin, tirarOPainel };
}
