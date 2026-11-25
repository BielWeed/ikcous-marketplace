/* eslint-disable security/detect-non-literal-fs-filename -- Só caminhos de mkdtemp criados aqui. */
// A guarda de invocação do fim de scripts/buildStore.mjs
// (process.argv[1] === este arquivo). Se ela cair, IMPORTAR o módulo passa a
// rodar um build de verdade e a mexer em process.exitCode, e o Vitest poderia
// sair com 0 (ou 1) por motivo nenhum. Este arquivo fica à parte de propósito:
// o Vite, a hospedagem e o sitemap são dublês, o diretório de trabalho é um
// mkdtemp descartável, e process.argv/exitCode voltam ao que eram em cada teste.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dubles = vi.hoisted(() => ({
  build: vi.fn(),
  loadEnv: vi.fn(),
  gerarHospedagem: vi.fn(),
  gerarSitemap: vi.fn(),
}));
vi.mock("vite", () => ({ build: dubles.build, loadEnv: dubles.loadEnv }));
vi.mock("../../scripts/hospedagem.mjs", () => ({
  gerarHospedagem: dubles.gerarHospedagem,
}));
vi.mock("../../scripts/sitemap.mjs", () => ({
  gerarSitemap: dubles.gerarSitemap,
}));

const script = path.resolve(
  import.meta.dirname,
  "../../scripts/buildStore.mjs",
);
const argvOriginal = [...process.argv];
const exitCodeOriginal = process.exitCode;
let raiz = "";

beforeEach(async () => {
  dubles.build.mockReset();
  dubles.loadEnv.mockReset();
  raiz = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "guarda-"));
  await fs.writeFile(path.join(raiz, "package.json"), '{"version":"1.2.3"}');
  vi.spyOn(process, "cwd").mockReturnValue(raiz);
  vi.resetModules();
});
afterEach(async () => {
  process.argv = argvOriginal;
  process.exitCode = exitCodeOriginal;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(raiz, { recursive: true, force: true });
});

async function importar() {
  // @ts-expect-error Node entry é JavaScript nativo, sem declaração de tipos.
  return import("../../scripts/buildStore.mjs");
}

describe("importar o módulo não é invocá-lo", () => {
  it("com outro script em argv[1]: nada roda, nada é impresso, exitCode intacto", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.argv = [argvOriginal[0] ?? "node", path.join(raiz, "outro.js")];
    process.exitCode = undefined;
    await importar();
    expect(dubles.build).not.toHaveBeenCalled();
    expect(dubles.loadEnv).not.toHaveBeenCalled();
    expect(erro).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("sem argv[1] (REPL, -e): importa sem quebrar e sem rodar", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.argv = [argvOriginal[0] ?? "node"];
    process.exitCode = undefined;
    await importar();
    expect(dubles.build).not.toHaveBeenCalled();
    expect(erro).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});

describe("rodar como script (argv[1] é este arquivo)", () => {
  it("com argumento a mais: recusa sem chamar o Vite, imprime e marca exitCode 1", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.argv = [argvOriginal[0] ?? "node", script, "--segredo-ficticio"];
    process.exitCode = undefined;
    await importar();
    expect(dubles.build).not.toHaveBeenCalled();
    expect(erro).toHaveBeenCalledTimes(1);
    const linha = String(erro.mock.calls[0]?.[0]);
    expect(linha).toBe(
      "IDENTITY_BUILD_FAILED: entrega não confirmada. Causa: IDENTITY_OPTIONS",
    );
    expect(linha).not.toContain("segredo-ficticio");
    expect(process.exitCode).toBe(1);
  });

  it("sem argumento: roda o build da pasta atual; falha do Vite sai lavada e com exitCode 1", async () => {
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "fixture");
    vi.stubEnv("MINHA_CHAVE_DE_TESTE_KEY", "valor-do-ambiente-777");
    dubles.loadEnv.mockReturnValue({ IKCOUS_IDENTITY_MODE: "fixture" });
    dubles.build.mockRejectedValue(
      new Error("vite caiu com valor-do-ambiente-777"),
    );
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.argv = [argvOriginal[0] ?? "node", script];
    process.exitCode = undefined;
    await importar();
    expect(dubles.build).toHaveBeenCalledTimes(1);
    expect(dubles.build.mock.calls[0]?.[0].root).toBe(raiz);
    expect(erro).toHaveBeenCalledTimes(1);
    expect(String(erro.mock.calls[0]?.[0])).toBe(
      "IDENTITY_BUILD_FAILED: entrega não confirmada. Causa: vite caiu com [oculto]",
    );
    expect(process.exitCode).toBe(1);
  });
});
