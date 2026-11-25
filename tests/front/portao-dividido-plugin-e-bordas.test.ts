/* eslint-disable security/detect-non-literal-fs-filename -- todos os caminhos nascem de um mkdtemp descartável deste próprio arquivo, nunca de entrada externa. */
// scripts/portaoDividido.ts — o que decide em qual teto (cliente ou painel) cada
// chunk do build é medido. tests/front/portao-dividido-classificacao.test.ts
// prova a classificação com bundles falsos; uma caça por mutação achou duas
// decisões sem teste, e este arquivo as fecha:
//
//   1. um chunk citado em `imports` que NÃO está no bundle (dependência
//      externa, chunk descartado) não pode derrubar a classificação — sem a
//      guarda, o build quebra com "Cannot read properties of undefined";
//   2. o plugin do Vite (`generateBundle`) só classifica CHUNKS (assets de
//      imagem/css não entram em nenhum dos dois tetos) e grava o resultado
//      fora da entrega, em `.portao-tamanho/<saída>.json`, com o formato que
//      o `.size-limit.cjs` lê.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ChunkParaClassificar,
  classificarBundle,
  portaoDividido,
} from "../../scripts/portaoDividido";

function chunk(
  parcial: Partial<ChunkParaClassificar> & { fileName: string },
): ChunkParaClassificar {
  return {
    isEntry: false,
    isDynamicEntry: false,
    moduleIds: [],
    imports: [],
    dynamicImports: [],
    ...parcial,
  };
}

describe("classificarBundle — bordas", () => {
  it("import de um chunk que não existe no bundle é ignorado (não lança) e não entra em nenhum grupo", () => {
    const r = classificarBundle([
      chunk({
        fileName: "assets/index.js",
        isEntry: true,
        imports: ["assets/fantasma.js"],
        dynamicImports: ["assets/outro-fantasma.js", "assets/loja.js"],
      }),
      chunk({ fileName: "assets/loja.js" }),
    ]);
    expect(r).toEqual({
      versao: 1,
      cliente: ["assets/index.js", "assets/loja.js"],
      painel: [],
    });
  });

  it("chunk sem caminho até a entrada e fora da fronteira cai no painel; o leitor zxing fica fora dos dois grupos; a saída é ordenada", () => {
    const r = classificarBundle([
      chunk({
        fileName: "assets/z.js",
        isEntry: true,
        imports: ["assets/b.js"],
      }),
      chunk({ fileName: "assets/b.js" }),
      chunk({ fileName: "assets/a.js", isEntry: true }),
      chunk({ fileName: "assets/solto.js" }),
      chunk({ fileName: "assets/leitor-zxing-abc123.js", isEntry: false }),
    ]);
    expect(r.cliente).toEqual(["assets/a.js", "assets/b.js", "assets/z.js"]);
    expect(r.painel).toEqual(["assets/solto.js"]);
    expect([...r.cliente, ...r.painel]).not.toContain(
      "assets/leitor-zxing-abc123.js",
    );
  });
});

describe("portaoDividido (plugin do Vite) — generateBundle", () => {
  let raiz = "";
  beforeAll(() => {
    raiz = mkdtempSync(path.join(os.tmpdir(), "ikcous-portao-"));
  });
  afterAll(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it("classifica só os CHUNKS do bundle, ignora assets e grava o JSON fora da entrega", async () => {
    const plugin = portaoDividido({ root: raiz, outDir: "dist-teste" });
    expect(plugin.name).toBe("portao-dividido-tamanho");
    expect(plugin.apply).toBe("build");
    const gerar = plugin.generateBundle as (
      this: unknown,
      options: unknown,
      bundle: Record<string, unknown>,
    ) => Promise<void>;
    await gerar.call(
      {},
      {},
      {
        "assets/index.js": {
          type: "chunk",
          fileName: "assets/index.js",
          isEntry: true,
          isDynamicEntry: false,
          moduleIds: ["/repo/src/main.tsx"],
          imports: [],
          dynamicImports: ["assets/AdminArea.js"],
        },
        "assets/AdminArea.js": {
          type: "chunk",
          fileName: "assets/AdminArea.js",
          isEntry: false,
          isDynamicEntry: true,
          moduleIds: ["/repo/src/components/layouts/AdminArea.tsx"],
          imports: [],
          dynamicImports: [],
        },
        "assets/logo.png": {
          type: "asset",
          fileName: "assets/logo.png",
          source: new Uint8Array(),
        },
        "assets/estilo.css": {
          type: "asset",
          fileName: "assets/estilo.css",
          source: "body{}",
        },
      },
    );
    const gravado = readFileSync(
      path.join(raiz, ".portao-tamanho", "dist-teste.json"),
      "utf8",
    );
    expect(gravado.endsWith("}\n")).toBe(true);
    expect(JSON.parse(gravado)).toEqual({
      versao: 1,
      cliente: ["assets/index.js"],
      painel: ["assets/AdminArea.js"],
    });
  });

  it("cada saída (dist, dist-test) grava no SEU arquivo: um build não sobrescreve o do outro", async () => {
    const gerar = async (outDir: string, fileName: string) => {
      const plugin = portaoDividido({ root: raiz, outDir });
      await (
        plugin.generateBundle as unknown as (
          o: unknown,
          b: Record<string, unknown>,
        ) => Promise<void>
      ).call(
        {},
        {},
        {
          [fileName]: {
            type: "chunk",
            fileName,
            isEntry: true,
            isDynamicEntry: false,
            moduleIds: [],
            imports: [],
            dynamicImports: [],
          },
        },
      );
    };
    await gerar("dist", "assets/um.js");
    await gerar("dist-test", "assets/dois.js");
    const ler = (nome: string) =>
      JSON.parse(
        readFileSync(
          path.join(raiz, ".portao-tamanho", `${nome}.json`),
          "utf8",
        ),
      );
    expect(ler("dist").cliente).toEqual(["assets/um.js"]);
    expect(ler("dist-test").cliente).toEqual(["assets/dois.js"]);
  });
});
