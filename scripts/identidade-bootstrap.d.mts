// Declaracao de tipos do lancador (.mjs) para quem o importa de um .ts --
// tests/front/identidade-bootstrap-lancador.test.ts (achado A1 da revisao
// A11). TS nao tem `allowJs` neste projeto (tsconfig.app.json so' inclui
// `src` e `tests/front`); sem isto, `import { principal } from
// "../../scripts/identidade-bootstrap.mjs"` vira TS7016 (implicit any).
// `.d.mts` e' a extensao que o TypeScript associa a um `.mjs` do mesmo nome
// (par ESM), nao precisa de referencia explicita em nenhum lugar.
import type {
  ObjetoDoKit,
  PortaBanco,
  PortaStorage,
} from "./identidadeBootstrap";

export interface FabricasLancador {
  readonly portaBanco?: (databaseUrl: string, nucleo: unknown) => PortaBanco;
  readonly portaStorage?: (workdir: string, nucleo: unknown) => PortaStorage;
  readonly fetchImpl?: typeof fetch;
  readonly carregarNucleo?: () => Promise<unknown>;
}

export function principal(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  fabricas?: FabricasLancador,
): Promise<number>;

// Tarefa A11e: expostas para o teste (executavelNpx) e para a prova offline
// do lancador (quotarWindows) montarem o MESMO comando que a `cli()` real.
export function quotarWindows(valor: unknown): string;

export function executavelNpx(args: {
  readonly plataforma: string;
  readonly execPath: string;
  readonly existe: (caminho: string) => boolean;
}): string;

// Pendencia A11e (revisao A11d/A11e): monta o comando final de win32, sem
// quotar o literal "npx" do fallback de executavelNpx (aspas ali quebram o
// %~dp0 do proprio npx.cmd) -- os demais elementos sempre quotam.
export function quotarComando(partes: readonly string[]): string;

// Tarefa A11f: pura, sem spawnSync -- monta o MESMO comando que
// portaStorage.subir() manda ao CLI, para o teste comparar sem rede.
export function montarChamadaCp(
  objeto: ObjetoDoKit,
  args: {
    readonly plataforma: string;
    readonly execPath: string;
    readonly existe: (caminho: string) => boolean;
    readonly workdir: string;
  },
): { readonly cwd: string; readonly partes: readonly string[] };

// Pendencia A11f (ANOTADO B): casa um conflito real de "objeto ja existe"
// pelo campo statusCode do JSON de erro do CLI, nunca por substring solta
// (um sha256 pode conter "409"). A forma exata do campo e' PRESUMIDA, nao
// medida -- casa a forma numerica e a forma string; se a forma real do CLI
// for outra, falha fechado (409 vira erro generico de upload).
export function ehConflito409(saidaCrua: unknown): boolean;

// Revisao A11g (BLOQUEIA): interpreta o resultado de uma chamada `supabase
// storage cp/rm` sem depender de BootstrapError -- quem chama decide o que
// fazer com cada desfecho. Um 409 confirmado e' sempre "conflito-409"
// (nunca sucesso silencioso): "pular" aqui faria o nucleo colocar o path
// na lista que `--desfazer --subidos` apaga do bucket.
export function interpretarResultadoCp(r: {
  readonly status: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
}):
  | { readonly desfecho: "ok"; readonly stdout: string | undefined }
  | { readonly desfecho: "conflito-409"; readonly saidaCrua: string }
  | { readonly desfecho: "falha"; readonly saidaCrua: string };
