// Caça por mutação em scripts/hospedagem.mjs (25/11/2026): a guarda de
// compilarWorker contra um build que "deu certo" mas não entregou exatamente
// UM arquivo (ou trouxe erros) é inalcançável com o esbuild de verdade, que
// lança sozinho nos erros e, com um ponto de entrada e write:false, sempre
// devolve um arquivo. Aqui o esbuild é um dublê em memória (nada compila de
// verdade), só para provar a guarda e o texto devolvido sem acréscimo.
import { describe, expect, it, vi } from "vitest";

const buildMock = vi.hoisted(() => vi.fn());
vi.mock("esbuild", () => ({ build: buildMock, default: { build: buildMock } }));

// @ts-expect-error Módulo JS nativo sem declaração.
import * as hospedagem from "../../scripts/hospedagem.mjs";

const CONFIG = { deliveryVersion: "1.0.0-teste" };

describe("compilarWorker com esbuild em memória", () => {
  it("devolve o texto do único arquivo gerado, sem nada a mais", async () => {
    buildMock.mockResolvedValueOnce({
      errors: [],
      outputFiles: [{ text: "export default {};" }],
    });
    await expect(hospedagem.compilarWorker(CONFIG)).resolves.toBe(
      "export default {};",
    );
  });

  it("repassa ao esbuild o banner com a versão e o JSON da config", async () => {
    buildMock.mockResolvedValueOnce({
      errors: [],
      outputFiles: [{ text: "x" }],
    });
    await hospedagem.compilarWorker(CONFIG);
    const opcoes = buildMock.mock.calls.at(-1)?.[0];
    expect(opcoes.banner.js).toBe(
      `// IKCOUS hospedagem 1.0.0-teste\nconst __IKCOUS_HOSPEDAGEM__ = ${JSON.stringify(CONFIG)};`,
    );
    expect(opcoes).toMatchObject({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent",
    });
  });

  it("zero arquivos de saída reprova com HOSTING_WORKER_BUILD (não com erro de tipo)", async () => {
    buildMock.mockResolvedValueOnce({ errors: [], outputFiles: [] });
    await expect(hospedagem.compilarWorker(CONFIG)).rejects.toThrow(
      /^HOSTING_WORKER_BUILD$/,
    );
  });

  it("dois arquivos de saída também reprovam", async () => {
    buildMock.mockResolvedValueOnce({
      errors: [],
      outputFiles: [{ text: "a" }, { text: "b" }],
    });
    await expect(hospedagem.compilarWorker(CONFIG)).rejects.toThrow(
      /^HOSTING_WORKER_BUILD$/,
    );
  });

  it("erros reportados reprovam mesmo com um arquivo de saída", async () => {
    buildMock.mockResolvedValueOnce({
      errors: [{ text: "falhou" }],
      outputFiles: [{ text: "a" }],
    });
    await expect(hospedagem.compilarWorker(CONFIG)).rejects.toThrow(
      /^HOSTING_WORKER_BUILD$/,
    );
  });

  it("sem lista de saída (undefined) reprova", async () => {
    buildMock.mockResolvedValueOnce({ errors: [] });
    await expect(hospedagem.compilarWorker(CONFIG)).rejects.toThrow(
      /^HOSTING_WORKER_BUILD$/,
    );
  });
});
