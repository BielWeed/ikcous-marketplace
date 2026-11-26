// `descartarFotosDoProduto` e a pirâmide de cópias (plano das miniaturas,
// 26/11/2026): o envio atrasado de uma foto MARCADA gravou 4 objetos (as 3
// cópias e, por último, a original `<uuid>-vw.<ext>`). Descartar só a original
// deixaria as cópias órfãs; descartar só pelo nome da cópia nunca acontece
// (o envio devolve a URL da original). As barreiras de sempre continuam: só a
// URL que o envio gera, do Supabase da loja, no bucket `products`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: mocks.from } },
}));

import { descartarFotosDoProduto } from "@/lib/descartar-fotos-do-produto";

const ORIGEM = "https://loja.supabase.co";
const BASE = `${ORIGEM}/storage/v1/object/public/products/`;
const UUID = "3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d";
const UUID2 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("descartarFotosDoProduto — foto marcada leva as 3 cópias", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", ORIGEM);
    mocks.remove.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValue({ remove: mocks.remove });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("original marcada (cópias WebP): apaga a original e as 3 cópias, numa chamada", async () => {
    await descartarFotosDoProduto([`${BASE}${UUID}-vw.jpg`]);
    expect(mocks.from).toHaveBeenCalledWith("products");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith([
      `${UUID}-vw.jpg`,
      `${UUID}-240.webp`,
      `${UUID}-480.webp`,
      `${UUID}-960.webp`,
    ]);
  });

  it("original marcada com cópias JPEG (marca j)", async () => {
    await descartarFotosDoProduto([`${BASE}${UUID}-vj.PNG`]);
    expect(mocks.remove).toHaveBeenCalledWith([
      `${UUID}-vj.PNG`,
      `${UUID}-240.jpg`,
      `${UUID}-480.jpg`,
      `${UUID}-960.jpg`,
    ]);
  });

  it("foto sem marca continua apagando só ela", async () => {
    await descartarFotosDoProduto([`${BASE}${UUID}.jpg`]);
    expect(mocks.remove).toHaveBeenCalledWith([`${UUID}.jpg`]);
  });

  it("mistura de marcada e sem marca: tudo numa chamada só", async () => {
    await descartarFotosDoProduto([
      `${BASE}${UUID}.jpg`,
      `${BASE}${UUID2}-vw.webp`,
    ]);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith([
      `${UUID}.jpg`,
      `${UUID2}-vw.webp`,
      `${UUID2}-240.webp`,
      `${UUID2}-480.webp`,
      `${UUID2}-960.webp`,
    ]);
  });

  it.each([
    ["marca desconhecida", `${BASE}${UUID}-vx.jpg`],
    ["a própria cópia", `${BASE}${UUID}-240.webp`],
    [
      "cópia de duplicação (o envio nunca gera)",
      `${BASE}${UUID}_copia_${UUID2}-vw.jpg`,
    ],
    ["backup", `${BASE}backup/${UUID}-vw.jpg`],
    ["com consulta", `${BASE}${UUID}-vw.jpg?v=1`],
    ["com fragmento", `${BASE}${UUID}-vw.jpg#x`],
    [
      "outro host",
      `https://outra.supabase.co/storage/v1/object/public/products/${UUID}-vw.jpg`,
    ],
    [
      "outro bucket",
      `${ORIGEM}/storage/v1/object/public/banners/${UUID}-vw.jpg`,
    ],
    ["til no lugar do hífen", `${BASE}${UUID}~vw.jpg`],
  ])("%s: recusada, nada apagado", async (_caso, url) => {
    await descartarFotosDoProduto([url]);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
