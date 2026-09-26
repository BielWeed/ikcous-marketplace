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
  readonly versao: 1;
  readonly cliente: readonly string[];
  readonly painel: readonly string[];
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
 * tem orçamento próprio em `.size-limit.cjs` (C2.5).
 */
export function classificarBundle(
  chunks: readonly ChunkParaClassificar[],
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
  const cliente: string[] = [];
  const painel: string[] = [];
  for (const chunk of chunks) {
    if (ARQUIVO_DO_LEITOR_ZXING.test(chunk.fileName)) continue;
    (alcancado.has(chunk.fileName) ? cliente : painel).push(chunk.fileName);
  }
  cliente.sort();
  painel.sort();
  return { versao: 1, cliente, painel };
}

/**
 * Plugin build-only: no `generateBundle`, classifica os chunks JS do output
 * (Rollup já resolveu `imports`/`dynamicImports`/`moduleIds` nesse ponto) e
 * grava o resultado FORA da entrega — nunca em `dist`/`dist-test`, que
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
      const chunks: ChunkParaClassificar[] = Object.values(bundle)
        .filter((item): item is Rollup.OutputChunk => item.type === "chunk")
        .map((chunk) => ({
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
          isDynamicEntry: chunk.isDynamicEntry,
          moduleIds: chunk.moduleIds,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
        }));
      const classificacao = classificarBundle(chunks);
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.writeFile(
        destino,
        `${JSON.stringify(classificacao, null, 2)}\n`,
        "utf8",
      );
    },
  };
}
