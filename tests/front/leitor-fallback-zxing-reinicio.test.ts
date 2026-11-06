// @vitest-environment node
//
// O adaptador real da zxing-wasm (src/lib/leitor/fallback-zxing.ts) tem de
// oferecer um REINÍCIO de verdade: a lib guarda por dentro a promessa de
// instanciação do WASM (inclusive rejeitada) e devolve a MESMA promessa para
// sempre; só `purgeZXingModule()` solta esse cache. Depois do purge o padrão
// da lib volta para o CDN jsDelivr, que a CSP da loja não libera — por isso
// o reinício TEM de preparar o módulo de novo com o `locateFile` local.
// A lib é dublada (sem baixar WASM); o que se prova aqui é a ORDEM e o
// argumento das chamadas.
import { describe, expect, it, vi } from "vitest";

const lib = vi.hoisted(() => ({
  urlLocalDoWasm: "/assets/zxing_reader-teste.wasm",
  chamadas: [] as string[],
  overrides: [] as Array<{ locateFile?: () => string }>,
}));

vi.mock("zxing-wasm/reader", () => ({
  prepareZXingModule: vi.fn(
    (opcoes?: { overrides?: { locateFile?: () => string } }) => {
      lib.chamadas.push("prepare");
      lib.overrides.push(opcoes?.overrides ?? {});
    },
  ),
  purgeZXingModule: vi.fn(() => {
    lib.chamadas.push("purge");
  }),
  readBarcodes: vi.fn(async () => []),
}));
vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({
  default: lib.urlLocalDoWasm,
}));

import { moduloZxing } from "@/lib/leitor/fallback-zxing";

describe("fallback-zxing: reinício real da lib", () => {
  it("reiniciar() faz purge e DEPOIS prepare com o locateFile local (nunca o CDN)", () => {
    // Carregar o módulo já registrou o override uma vez.
    expect(lib.chamadas).toEqual(["prepare"]);

    expect(typeof moduloZxing.reiniciar).toBe("function");
    moduloZxing.reiniciar?.();

    expect(lib.chamadas).toEqual(["prepare", "purge", "prepare"]);
    const depoisDoPurge = lib.overrides[1];
    expect(depoisDoPurge?.locateFile?.()).toBe(lib.urlLocalDoWasm);
  });
});
