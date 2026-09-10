// Declaracao de tipos do lancador (.mjs) para quem o importa de um .ts --
// tests/front/identidade-bootstrap-lancador.test.ts (achado A1 da revisao
// A11). TS nao tem `allowJs` neste projeto (tsconfig.app.json so' inclui
// `src` e `tests/front`); sem isto, `import { principal } from
// "../../scripts/identidade-bootstrap.mjs"` vira TS7016 (implicit any).
// `.d.mts` e' a extensao que o TypeScript associa a um `.mjs` do mesmo nome
// (par ESM), nao precisa de referencia explicita em nenhum lugar.
import type { PortaBanco, PortaStorage } from "./identidadeBootstrap";

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
