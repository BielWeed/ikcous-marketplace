// Caça por mutação em scripts/buildStore.mjs (25/11/2026): o rodapé do arquivo
// (a guarda `process.argv[1] === este arquivo` e a CLI que imprime a causa e
// marca `process.exitCode = 1`) não tinha nenhum teste. Sem a guarda, qualquer
// teste que só IMPORTA `buildStore.mjs` (store-delivery-contract, por exemplo)
// dispararia um `vite build` de verdade na pasta do projeto.
//
// SEGURANÇA DESTE TESTE: `vite` é um dublê cujo `loadEnv` lança. Se a guarda
// quebrar e o `main` rodar durante o import, ele morre ali, antes de qualquer
// build, e nada é escrito em disco. Nada de rede.
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const loadEnvMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("vite simulado: sem build de verdade");
  }),
);
const buildMock = vi.hoisted(() => vi.fn());
vi.mock("vite", () => ({
  build: buildMock,
  loadEnv: loadEnvMock,
  default: { build: buildMock, loadEnv: loadEnvMock },
}));

const SCRIPT = fileURLToPath(
  new URL("../../scripts/buildStore.mjs", import.meta.url),
);
const argvOriginal = [...process.argv];
const exitCodeOriginal = process.exitCode;

afterEach(() => {
  process.argv = [...argvOriginal];
  process.exitCode = exitCodeOriginal;
});

async function carregar(argv: string[]) {
  vi.resetModules();
  loadEnvMock.mockClear();
  buildMock.mockClear();
  const erros: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...a) => {
    erros.push(a.join(" "));
  });
  process.exitCode = undefined;
  process.argv = argv;
  // @ts-expect-error Módulo JS nativo sem declaração (mesmo padrão dos testes vizinhos).
  await import("../../scripts/buildStore.mjs");
  return { erros, codigo: process.exitCode };
}

describe("buildStore.mjs: guarda de invocação e CLI", () => {
  it("importado por outro comando, não builda, não imprime e não mexe no código de saída", async () => {
    const r = await carregar([process.argv[0], "/outro/comando.mjs"]);
    expect(loadEnvMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
    expect(r.erros).toEqual([]);
    expect(r.codigo).toBeUndefined();
  });

  it("sem argv[1] (REPL, node -e) também não builda", async () => {
    const r = await carregar([process.argv[0]]);
    expect(loadEnvMock).not.toHaveBeenCalled();
    expect(r.erros).toEqual([]);
    expect(r.codigo).toBeUndefined();
  });

  it("rodado como comando, tenta o build UMA vez e, se falhar, diz a causa e sai com 1", async () => {
    const r = await carregar([process.argv[0], SCRIPT]);
    expect(loadEnvMock).toHaveBeenCalledTimes(1);
    expect(r.erros).toEqual([
      "IDENTITY_BUILD_FAILED: entrega não confirmada. Causa: vite simulado: sem build de verdade",
    ]);
    expect(r.codigo).toBe(1);
  });

  it("rodado como comando com argumento sobrando, recusa ANTES de tocar o vite", async () => {
    const r = await carregar([process.argv[0], SCRIPT, "--qualquer"]);
    expect(loadEnvMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
    expect(r.erros).toEqual([
      "IDENTITY_BUILD_FAILED: entrega não confirmada. Causa: IDENTITY_OPTIONS",
    ]);
    expect(r.codigo).toBe(1);
  });
});
