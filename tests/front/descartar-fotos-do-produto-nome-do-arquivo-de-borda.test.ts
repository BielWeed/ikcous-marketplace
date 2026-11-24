// Caça de provas fracas (mutação) em `descartarFotosDoProduto`, 24/11/2026.
// Apagar do bucket é irreversível, então a regra do NOME do arquivo é a
// barreira que importa: só `<uuid minúsculo>.<ext de 2 a 5 letras>`. A tabela
// hostil do teste principal não pegava três afrouxamentos, e cada um apagaria
// um arquivo que o envio nunca criou:
//
//  - extensão de UMA letra ("uuid.a");
//  - separador qualquer no lugar do ponto ("uuid_jpg", "uuid-jpg");
//  - UUID com a primeira parte em MAIÚSCULAS (o envio grava em minúsculas).
//
// Em todos o caminho certo é o mesmo: não chama o storage, só avisa no log.
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

describe("descartarFotosDoProduto — nomes que NÃO têm a cara de um envio", () => {
  let aviso: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", ORIGEM);
    mocks.remove.mockReset();
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValue({ remove: mocks.remove });
    aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["extensão de uma letra", `${UUID}.a`],
    ["extensão de seis letras", `${UUID}.abcdef`],
    ["sem extensão", UUID],
    ["separador '_' no lugar do ponto", `${UUID}_jpg`],
    ["separador '-' no lugar do ponto", `${UUID}-jpg`],
    ["letra no lugar do ponto", `${UUID}xjpg`],
    ["UUID com a primeira parte em maiúsculas", `3F2B8C1E${UUID.slice(8)}.jpg`],
    ["UUID todo em maiúsculas", `${UUID.toUpperCase()}.jpg`],
  ])("%s: não apaga, só avisa", async (_motivo, nome) => {
    await descartarFotosDoProduto([`${BASE}${nome}`]);

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("a mesma URL com o nome certo (uuid minúsculo, ponto, 3 letras) apaga", async () => {
    await descartarFotosDoProduto([`${BASE}${UUID}.png`]);

    expect(mocks.remove).toHaveBeenCalledWith([`${UUID}.png`]);
  });
});
