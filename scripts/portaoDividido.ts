/* eslint-disable security/detect-non-literal-fs-filename -- Destino fixo (raiz do repo + ".portao-tamanho" + saída fechada "dist"/"dist-test"), nunca texto de usuário. */
import fs from "node:fs/promises";
import path from "node:path";
import type { Plugin, Rollup } from "vite";

/**
 * Portão de tamanho DIVIDIDO (decisão do dono, 26/09/2026): o `.size-limit.cjs`
 * parou de somar TODO `assets/*.js` num teto só — cliente (o que qualquer
 * visitante pode baixar) e painel (o que só existe atrás do `is_admin` do
 * servidor) viraram orçamentos separados. Este arquivo classifica a partir do
 * grafo REAL do Rollup — nunca por nome de arquivo — e devolve a lista de cada
 * lado; `portaoDividido()` grava o resultado num JSON fora da entrega, que
 * `.size-limit.cjs` lê e confere contra o disco antes de aplicar os tetos.
 *
 * Por que a fronteira olha `moduleIds` (TODOS os módulos-fonte de um chunk),
 * não só `facadeModuleId` (medido no fixture de 26/09/2026 — a 1ª versão
 * casava só `facadeModuleId === AdminArea.tsx` e devolveu 113 chunks em
 * `cliente` contra 1 em `painel`; a 2ª casava `facadeModuleId` sob
 * `src/views/admin/**` e ainda deixou `AdminSettingsView` (13,96 kB) em
 * `cliente`): duas causas independentes, as duas exigem o grafo REAL:
 *
 *   1. `AdminAreaGate` (`src/components/layouts/AdminAreaGate.tsx`) é o único
 *      portão que confere `is_admin` antes de montar o painel, mas não é o
 *      único lugar do bundle com um `import()` literal por tela do admin:
 *      `src/hooks/usePrefetchOnHover.ts` mantém um SEGUNDO mapa
 *      (`VIEW_PREFETCH_MAP`) com um `import("@/views/admin/...")` próprio
 *      para CADA tela — para aquecer o chunk no hover de quem já está dentro
 *      do painel (`AdminLayout.tsx`). Esse hook é importado ESTATICAMENTE em
 *      `src/App.tsx`, então o chunk de ENTRADA "dynamicImports" cada tela do
 *      admin direto, sem passar por `AdminArea.tsx`. Nenhum boundary de UM
 *      chunk só segura essa segunda borda — por isso a fronteira também casa
 *      por CAMINHO de módulo (`src/views/admin/**`), não só por chunk-gate.
 *
 *   2. `experimentalMinChunkSize` (vite.config.ts) funde chunk pequeno num
 *      vizinho — e quando o resultado deixa de corresponder a UM módulo só,
 *      o Rollup zera `facadeModuleId` (vira `null`). `AdminSettingsView`
 *      virou exatamente isso: seu chunk final tem `facadeModuleId: null` e
 *      `moduleIds` com 6 módulos — todos sob `src/components/admin/` ou
 *      `src/views/admin/`. Um merge só funde chunk cujo(s) importador(es) já
 *      é(são) o(s) mesmo(s) do hospedeiro (senão duplicaria bytes em quem
 *      não pediu); por isso ler TODOS os `moduleIds` em vez de só a fachada
 *      continua correto mesmo depois da fusão — se o hospedeiro é do painel,
 *      quem se fundiu nele também é.
 *
 * A exceção é `AdminLoginView`: é a ÚNICA tela sob `src/views/admin/**` que o
 * próprio App.tsx trata como pública de propósito (login do lojista, sem
 * `is_admin` — qualquer visitante pode abri-la), então fica de fora da regra
 * de caminho e o grafo a classifica como `cliente`.
 */

const CAMINHO_DA_FRONTEIRA = /\/src\/components\/layouts\/AdminArea\.tsx$/;
const CAMINHO_DAS_TELAS_DO_PAINEL = /\/src\/views\/admin\//;
const TELA_PUBLICA_DO_LOGIN = /\/AdminLoginView\.tsx$/;
const ARQUIVO_DO_LEITOR_ZXING = /^assets\/leitor-zxing-/;

/**
 * ALLOWLIST de CHUNKS OPCIONAIS SOB DEMANDA (decisão do dono Gabriel,
 * 29/09/2026, em voz): chunks que a cliente só baixa quando um recurso
 * específico é explicitamente usado — hoje, apenas o renderer de mapa
 * vetorial (`maplibre-gl`), importado dinamicamente SÓ quando um mapa do
 * cartão de endereço monta (Perfil › "Ver mais detalhes"). Têm orçamento
 * PRÓPRIO em `.size-limit.cjs` (250 kB), o mesmo precedente do leitor
 * zxing (400 kB) — e por isso saem da conta de `cliente`.
 *
 * A allowlist é de propósito RESTRITIVA (regex por nome de chunk, só o mapa):
 * qualquer outro dinâmico continua contando como cliente. É FAIL-CLOSED —
 * se o Rollup renomear o chunk (a estabilidade do nome vem do
 * `dynamicImport("maplibre-gl")` de `AddressCardMap.tsx`), ele deixa de
 * casar aqui, volta para `cliente`, e o teto de 550 kB reprova alto em vez
 * de deixar bytes sem dono.
 *
 * O NOME é condição necessária, não suficiente (achado maior da revisão da
 * PR #712, 13/10/2026): o chunk só vai para `opcional` se a cliente o alcança
 * SOMENTE por `import()` dinâmico — ver `soDinamicoNoCliente`. Importado
 * estaticamente por qualquer chunk que a cliente baixa, ele fica em
 * `cliente`, com o nome que tiver.
 *
 * Exportada (assim como `ARQUIVO_DO_WORKER_DO_MAPA`) só para o teste cruzado com o
 * precache do SW (`tests/front/portao-e-precache-concordam.test.ts`): o
 * `globIgnores` do `vite.config.ts` tem de cobrir todo nome que este arquivo
 * chama de "sob demanda".
 */
export const CHUNKS_OPCIONAIS: readonly RegExp[] = [/^assets\/maplibre-gl-/];

/**
 * ALLOWLIST do WORKER DO MAPA (decisão do dono, 12/10/2026): o MapLibre roda
 * o render num Web Worker que o `?worker&url` do `AddressCardMap.tsx` faz o
 * Vite empacotar à parte (~500 kB crus, ~116 kB brotli no build de
 * 13/10/2026). O Vite o emite como ASSET do Rollup (`emitFile({type:
 * "asset"})`, no `generateBundle` do plugin de worker), não como chunk: não
 * tem `imports`/`dynamicImports`/`moduleIds` e por isso não entra no grafo
 * acima — quem o carrega é o `new Worker(url)` do próprio MapLibre, só
 * depois que um mapa monta. Grupo PRÓPRIO (`workerDoMapa`, 130 kB em
 * `.size-limit.cjs`), nunca cliente/painel/opcional.
 *
 * Âncora nos dois lados e hash obrigatório (`[name]-[hash].js` do Vite; o
 * hash é base64url): qualquer outro asset `.js` — inclusive o `.mjs` cru que
 * um `?url` sozinho emitiria, ou o worker sem hash — conta em `cliente`
 * (fail-closed: o teto de 550 kB reprova alto).
 */
export const ARQUIVO_DO_WORKER_DO_MAPA =
  /^assets\/maplibre-gl-worker-[A-Za-z0-9_-]+\.js$/;

/** O mesmo recorte que `.size-limit.cjs` lê do disco: JS (`.js`/`.mjs`)
 * sob `assets/`. Asset fora disso (CSS, wasm, imagem, `.map`, JS na raiz da
 * saída) não é medido por este portão. Asset JS em SUBPASTA de `assets/`
 * entra aqui (vai para `cliente`) e o disco não o lista — o validador acusa
 * "só na classificação" e reprova, em vez de o arquivo escapar calado. */
const ASSET_JS_DA_ENTREGA = /^assets\/.+\.m?js$/;

/** Forma mínima que a classificação usa — não é `Rollup.OutputChunk` inteiro,
 * só o que o grafo de alcançabilidade lê. Mantém `classificarBundle` pura e
 * testável com um bundle falso, sem montar um chunk de verdade. */
export interface ChunkParaClassificar {
  readonly fileName: string;
  readonly isEntry: boolean;
  readonly isDynamicEntry: boolean;
  readonly moduleIds: readonly string[];
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
}

export interface ClassificacaoDoBundle {
  /** Versão 2 (29/09/2026): acrescenta `opcional` — chunks sob demanda com
   * teto próprio (allowlist `CHUNKS_OPCIONAIS`). Versão 3 (13/10/2026):
   * acrescenta `workerDoMapa` (allowlist `ARQUIVO_DO_WORKER_DO_MAPA`).
   * Versões anteriores não têm os grupos novos e são recusadas pelo
   * validador — fail-closed de ponta a ponta. */
  readonly versao: 3;
  readonly cliente: readonly string[];
  readonly painel: readonly string[];
  readonly opcional: readonly string[];
  readonly workerDoMapa: readonly string[];
}

function ehModuloDoPainel(moduleId: string): boolean {
  const id = moduleId.replace(/\\/g, "/");
  if (CAMINHO_DA_FRONTEIRA.test(id)) return true;
  return (
    CAMINHO_DAS_TELAS_DO_PAINEL.test(id) && !TELA_PUBLICA_DO_LOGIN.test(id)
  );
}

/**
 * Fronteira do painel: um chunk dinâmico onde QUALQUER módulo-fonte é o
 * chunk-gate (`AdminArea.tsx`, alcançado só depois do `is_admin` responder)
 * ou uma tela sob `src/views/admin/**` — MENOS `AdminLoginView`, a única
 * pública de propósito. Olhar `moduleIds` inteiro (não só a fachada) é o que
 * segura o caso do chunk fundido por `experimentalMinChunkSize` sem fachada
 * própria; ver a docstring do arquivo para os dois achados que exigiram isso.
 */
export function ehFronteiraDoPainel(
  chunk: Pick<ChunkParaClassificar, "isDynamicEntry" | "moduleIds">,
): boolean {
  if (!chunk.isDynamicEntry) return false;
  return chunk.moduleIds.some(ehModuloDoPainel);
}

/**
 * Busca a partir das raízes (chunks de entrada) sobre `imports` +
 * `dynamicImports`, SEM entrar nos chunks de fronteira — o chunk de fronteira
 * em si também não entra em `cliente` (só é alcançado depois do `is_admin`
 * responder, nenhum visitante o baixa por conta própria). Tudo alcançado vira
 * `cliente`; o resto vira `painel`. `leitor-zxing-*` fica de fora dos dois —
 * tem orçamento próprio em `.size-limit.cjs` (C2.5). O mesmo vale, desde
 * 29/09/2026, para os chunks da allowlist `CHUNKS_OPCIONAIS` (só o
 * `maplibre-gl-*` hoje): saem de `cliente`/`painel` e vão para `opcional`,
 * com teto próprio — quem decide a allowlist é este arquivo, auditável —
 * desde que a cliente só os alcance por `import()` dinâmico
 * (`soDinamicoNoCliente`, 13/10/2026).
 *
 * `assets` são os `fileName` dos ASSETS do mesmo output (13/10/2026): só os
 * JS de `assets/` contam; o worker do mapa vai para `workerDoMapa`, qualquer
 * outro JS para `cliente`. Obrigatório (sem padrão vazio) para que quem
 * chama não esqueça os assets calado.
 */
export function classificarBundle(
  chunks: readonly ChunkParaClassificar[],
  assets: readonly string[],
  ehFronteira: (
    chunk: Pick<ChunkParaClassificar, "isDynamicEntry" | "moduleIds">,
  ) => boolean = ehFronteiraDoPainel,
): ClassificacaoDoBundle {
  const porNome = new Map(
    chunks.map((chunk) => [chunk.fileName, chunk] as const),
  );
  const fronteira = new Set(
    chunks.filter((chunk) => ehFronteira(chunk)).map((chunk) => chunk.fileName),
  );
  const alcancado = new Set<string>();
  const fila = chunks
    .filter((chunk) => chunk.isEntry)
    .map((chunk) => chunk.fileName);
  while (fila.length > 0) {
    const nome = fila.pop();
    if (nome === undefined || alcancado.has(nome) || fronteira.has(nome))
      continue;
    alcancado.add(nome);
    const chunk = porNome.get(nome);
    if (!chunk) continue;
    for (const proximo of [...chunk.imports, ...chunk.dynamicImports]) {
      if (!alcancado.has(proximo)) fila.push(proximo);
    }
  }
  const ehSoDinamicoNoCliente = soDinamicoNoCliente(chunks, alcancado);
  const cliente: string[] = [];
  const painel: string[] = [];
  const opcional: string[] = [];
  const workerDoMapa: string[] = [];
  for (const chunk of chunks) {
    if (ARQUIVO_DO_LEITOR_ZXING.test(chunk.fileName)) continue;
    if (
      CHUNKS_OPCIONAIS.some((padrao) => padrao.test(chunk.fileName)) &&
      ehSoDinamicoNoCliente(chunk)
    ) {
      opcional.push(chunk.fileName);
      continue;
    }
    (alcancado.has(chunk.fileName) ? cliente : painel).push(chunk.fileName);
  }
  for (const asset of assets) {
    if (!ASSET_JS_DA_ENTREGA.test(asset)) continue;
    if (ARQUIVO_DO_LEITOR_ZXING.test(asset)) continue;
    (ARQUIVO_DO_WORKER_DO_MAPA.test(asset) ? workerDoMapa : cliente).push(
      asset,
    );
  }
  cliente.sort();
  painel.sort();
  opcional.sort();
  workerDoMapa.sort();
  return { versao: 3, cliente, painel, opcional, workerDoMapa };
}

/**
 * Alcançabilidade do `opcional` (achado maior da revisão da PR #712,
 * 13/10/2026): só o nome não basta — se o `import()` do `AddressCardMap.tsx`
 * virasse `import` estático, o chunk do maplibre passaria a viajar com a
 * rota (ou a entrada) de todo visitante e a allowlist por nome o esconderia
 * do teto de 550 kB. Um chunk é "só dinâmico no cliente" quando:
 *   - não é entrada (a página carrega a entrada sempre);
 *   - a cliente o alcança (`alcancado`) e ao menos um chunk dela o pede por
 *     `dynamicImports`;
 *   - NENHUM chunk que a cliente baixa o tem em `imports` (estático). Basta
 *     um: o estático o carrega junto com quem importa.
 * Alcançado só atrás da fronteira do painel não é "da cliente": segue a
 * regra geral e vai para `painel`.
 */
function soDinamicoNoCliente(
  chunks: readonly ChunkParaClassificar[],
  alcancado: ReadonlySet<string>,
): (chunk: ChunkParaClassificar) => boolean {
  const estaticoNoCliente = new Set<string>();
  const dinamicoNoCliente = new Set<string>();
  for (const chunk of chunks) {
    if (!alcancado.has(chunk.fileName)) continue;
    for (const nome of chunk.imports) estaticoNoCliente.add(nome);
    for (const nome of chunk.dynamicImports) dinamicoNoCliente.add(nome);
  }
  return (chunk) =>
    !chunk.isEntry &&
    alcancado.has(chunk.fileName) &&
    dinamicoNoCliente.has(chunk.fileName) &&
    !estaticoNoCliente.has(chunk.fileName);
}

/**
 * Plugin build-only: no `generateBundle`, classifica os chunks JS do output
 * (Rollup já resolveu `imports`/`dynamicImports`/`moduleIds` nesse ponto) e
 * os assets JS (o worker do mapa: o plugin de worker do Vite, que é do
 * núcleo e roda antes dos plugins do usuário, já o emitiu no `generateBundle`
 * dele) e grava o resultado FORA da entrega — nunca em `dist`/`dist-test`, que
 * `scripts/buildStore.mjs` valida e que é servido em produção. O caminho
 * inclui o nome da saída ("dist" ou "dist-test") porque database e fixture
 * podem rodar em sequência na mesma máquina e não podem compartilhar arquivo.
 */
export function portaoDividido(opcoes: {
  root: string;
  outDir: string;
}): Plugin {
  const destino = path.join(
    opcoes.root,
    ".portao-tamanho",
    `${opcoes.outDir}.json`,
  );
  return {
    name: "portao-dividido-tamanho",
    apply: "build",
    async generateBundle(_options, bundle) {
      const itens = Object.values(bundle);
      const chunks: ChunkParaClassificar[] = itens
        .filter((item): item is Rollup.OutputChunk => item.type === "chunk")
        .map((chunk) => ({
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
          isDynamicEntry: chunk.isDynamicEntry,
          moduleIds: chunk.moduleIds,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
        }));
      const assets = itens
        .filter((item): item is Rollup.OutputAsset => item.type === "asset")
        .map((asset) => asset.fileName);
      const classificacao = classificarBundle(chunks, assets);
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.writeFile(
        destino,
        `${JSON.stringify(classificacao, null, 2)}\n`,
        "utf8",
      );
    },
  };
}
