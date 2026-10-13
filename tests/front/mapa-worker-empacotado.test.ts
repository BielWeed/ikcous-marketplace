import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// O MapLibre 6.10 resolve o worker em RUNTIME por
// `new URL("./maplibre-gl-worker.mjs", import.meta.url)`. O build do Vite não
// emite esse arquivo (nem o `maplibre-gl-shared.mjs` que ele importa) e, sem
// `setWorkerUrl`, o navegador pede `/assets/maplibre-gl-worker.mjs`: no Vercel
// o rewrite `/(.*) -> /index.html` devolve HTML no lugar do worker e o mapa
// NUNCA carrega — só o timeout de 12 s do cartão rescata (achado da revisão
// da PR #712, 13/10/2026).
//
// O teste do cartão (`perfil-enderecos-mapa-por-cartao.test.tsx`) mocka o
// `maplibre-gl` inteiro e por isso nunca enxergou isso. ESTE arquivo lê o
// FONTE do componente, sem mock nenhum, e trava o contrato que faz o Vite
// empacotar o worker:
//   - `?worker&url` (o `?url` sozinho NÃO basta: o worker importa o shared) —
//     validado em harness com o Vite 7.3.6 do repositório;
//   - import DINÂMICO (a URL não pode entrar no JS inicial do cliente);
//   - `setWorkerUrl` antes do primeiro `new maplibregl.Map`.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo de arquivo do próprio repositório, sem entrada externa.
const fonte = readFileSync(
  new URL("../../src/components/ui/custom/AddressCardMap.tsx", import.meta.url),
  "utf8",
);

/** Tira comentários de bloco e de linha: a prosa do arquivo cita o specifier
 * do worker e `new maplibregl.Map`, e isso não pode satisfazer (nem quebrar)
 * o contrato. Nenhum specifier do código contém `//` fora de `://`. */
const codigo = fonte
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const ESPECIFICADOR_DO_WORKER =
  "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

describe("worker do MapLibre empacotado pelo Vite (contrato do fonte)", () => {
  it("importa a URL do worker por `?worker&url` (nunca `?url` sozinho, nunca nome fixo)", () => {
    // Todo specifier que menciona o arquivo do worker precisa ser exatamente
    // o `?worker&url` — `?url` sem `worker` emite só o arquivo, sem o shared.
    const mencoes = [
      ...codigo.matchAll(/["'`]([^"'`]*maplibre-gl-worker[^"'`]*)["'`]/g),
    ].map((achado) => achado[1]);
    expect(mencoes.length).toBeGreaterThan(0);
    for (const mencao of mencoes) expect(mencao).toBe(ESPECIFICADOR_DO_WORKER);
    // Nome fixo em /assets/ quebraria o `immutable` do vercel.json.
    expect(codigo).not.toMatch(/["'`]\/assets\/[^"'`]*worker/);
  });

  it("é import DINÂMICO: nenhum import estático arrasta o worker para o JS inicial", () => {
    expect(codigo).toContain(`import("${ESPECIFICADOR_DO_WORKER}")`);
    // `import x from "...?worker&url"` e `import "...?worker&url"` no topo
    // entrariam no bundle de quem importa o componente (AddressList → Perfil).
    expect(codigo).not.toMatch(/^\s*import\s[^;(]*["'][^"']*\?worker/m);
    // O `maplibre-gl` em si segue dinâmico pelo mesmo motivo (import de TIPO
    // é apagado pelo compilador e não conta).
    expect(codigo).toContain('import("maplibre-gl")');
    expect(codigo).not.toMatch(
      /^\s*import\s+(?!type\b)[^;(]*["']maplibre-gl["']/m,
    );
  });

  it("chama `setWorkerUrl` com a URL importada, antes do primeiro `new maplibregl.Map`", () => {
    const chamadas = [...codigo.matchAll(/\.setWorkerUrl\(\s*([^)]*?)\s*\)/g)];
    expect(chamadas, "uma única chamada no código").toHaveLength(1);
    // O argumento é a variável que recebeu a URL do import — nunca um literal.
    expect(chamadas[0][1]).toMatch(/^[A-Za-z_$][\w$.]*$/);

    const posicaoSetWorkerUrl = codigo.indexOf(".setWorkerUrl(");
    const posicaoNewMap = codigo.indexOf("new maplibregl.Map(");
    expect(posicaoNewMap, "o componente constrói o mapa").toBeGreaterThan(0);
    expect(posicaoSetWorkerUrl).toBeGreaterThan(0);
    expect(posicaoSetWorkerUrl).toBeLessThan(posicaoNewMap);

    // Mesmo caminho preguiçoso: a URL só existe depois dos DOIS imports
    // dinâmicos (o do maplibre e o do worker), no mesmo trecho que os faz.
    const posicaoImportDoMaplibre = codigo.indexOf('import("maplibre-gl")');
    const posicaoImportDoWorker = codigo.indexOf(
      `import("${ESPECIFICADOR_DO_WORKER}")`,
    );
    expect(posicaoImportDoMaplibre).toBeGreaterThan(0);
    expect(posicaoImportDoWorker).toBeGreaterThan(0);
    expect(posicaoImportDoMaplibre).toBeLessThan(posicaoSetWorkerUrl);
    expect(posicaoImportDoWorker).toBeLessThan(posicaoSetWorkerUrl);
  });

  it("o arquivo do worker existe na versão instalada do maplibre-gl (renomeou? o import quebra o build)", () => {
    // `require.resolve` segue o `exports` ("./dist/*") do pacote e acha o
    // node_modules certo mesmo quando a árvore de trabalho é um worktree.
    const caminho = createRequire(import.meta.url).resolve(
      "maplibre-gl/dist/maplibre-gl-worker.mjs",
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho resolvido de dependência do próprio repositório, sem entrada externa.
    expect(existsSync(caminho)).toBe(true);
  });
});
