// @vitest-environment jsdom
//
// "A imagem abre neste aparelho?" -- a conferência única que o banner, a foto
// de devolução e a foto de produto usam ANTES de aceitar o arquivo. O tipo que
// o navegador declara vem da extensão (um HEIC renomeado para .jpg diz
// image/jpeg), então só abrir de verdade prova que a foto serve.
//
// Primeiro o bitmap; se ele falhar, o próprio <img> é a segunda opinião (evita
// recusar foto boa que o bitmap não pegou, como um SVG). Só diz "não abre"
// quando as DUAS falham; ambiente sem como conferir segue (fail-open).
import { imagemAbre } from "@/lib/imagem-abre";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const arquivo = () => new File(["x"], "foto.jpg", { type: "image/jpeg" });

describe("imagemAbre", () => {
  let imgAbre: boolean;
  let srcDoImg: string[];
  let revogados: string[];

  beforeEach(() => {
    imgAbre = true;
    srcDoImg = [];
    revogados = [];
    URL.createObjectURL = () => "blob:teste";
    URL.revokeObjectURL = (endereco: string) => {
      revogados.push(endereco);
    };
    // O jsdom não decodifica: o dublê de <img> responde o que o teste manda.
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(v: string) {
          srcDoImg.push(v);
          queueMicrotask(() => (imgAbre ? this.onload : this.onerror)?.());
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("o bitmap abre: devolve true, solta o bitmap e nem consulta o <img>", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 10, height: 10, close }),
    );
    imgAbre = false; // se o <img> fosse consultado, diria que não abre

    expect(await imagemAbre(arquivo())).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(srcDoImg).toEqual([]);
  });

  it("nem o bitmap nem o <img> abrem: devolve false", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("não decodifica")),
    );
    imgAbre = false;

    expect(await imagemAbre(arquivo())).toBe(false);
  });

  it("o bitmap falha mas o <img> abre: devolve true (nada de recusar foto boa)", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("memória")),
    );
    imgAbre = true;

    expect(await imagemAbre(arquivo())).toBe(true);
  });

  it("sem createImageBitmap, o <img> que não abre basta para dizer que não", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    imgAbre = false;

    expect(await imagemAbre(arquivo())).toBe(false);
  });

  it("solta o endereço temporário do arquivo, abrindo ou não", async () => {
    vi.stubGlobal("createImageBitmap", undefined);

    imgAbre = true;
    await imagemAbre(arquivo());
    imgAbre = false;
    await imagemAbre(arquivo());

    expect(revogados).toEqual(["blob:teste", "blob:teste"]);
  });

  it("fail-open: sem como criar o endereço do arquivo, segue (true)", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    URL.createObjectURL = () => {
      throw new Error("sem suporte");
    };
    imgAbre = false;

    expect(await imagemAbre(arquivo())).toBe(true);
  });

  it("fail-open: ambiente sem <img> (sem como conferir) segue (true)", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("Image", undefined);

    expect(await imagemAbre(arquivo())).toBe(true);
  });
});
