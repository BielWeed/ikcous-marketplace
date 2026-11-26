// Duplicar produto e a pirâmide de cópias (plano das miniaturas, 26/11/2026).
//
// A duplicação dá a cada foto um arquivo PRÓPRIO (`_copia_<uuid>`). Com a foto
// MARCADA (`<uuid>-vw.<ext>`), o nome antigo da cópia punha o `_copia_` no
// lugar da extensão e a marca ficava no meio (`<uuid>-vw_copia_<x>.jpg`):
// a cópia perdia as miniaturas. Agora:
//   - `caminhoDaCopia` PRESERVA a marca: `<uuid>_copia_<x>-vw.jpg`;
//   - `copiarImagemParaDuplicacao` copia as 3 cópias PRIMEIRO e a original
//     marcada por ÚLTIMO (nunca existe endereço marcado sem as 3 cópias);
//   - cópia que falha: as já copiadas são apagadas e a original é copiada SEM
//     marca (o nome antigo) -- a duplicação segue, só sem miniaturas;
//   - rede sem resposta: o erro "sem resposta" sobe na hora, como hoje (o
//     diálogo se solta no prazo de uma foto), e nada marcado é criado.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  copy: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        if (bucket !== "products") throw new Error(`bucket ${bucket}`);
        return {
          copy: (...args: unknown[]) => h.copy(...args),
          remove: (...args: unknown[]) => h.remove(...args),
          getPublicUrl: (caminho: string) => ({
            data: {
              publicUrl: `https://loja.supabase.co/storage/v1/object/public/products/${caminho}`,
            },
          }),
        };
      },
    },
  },
}));

import { copiarImagemParaDuplicacao } from "@/hooks/useProducts";
import {
  caminhoDaCopia,
  caminhoDaCopiaSemMarca,
} from "@/lib/copiar-imagem-para-duplicacao";
import { marcaDe, marcaDoNome } from "@/lib/piramide-da-foto-nomes";
import {
  MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA,
  PRAZO_DE_COPIAR_A_FOTO_PARA_DUPLICAR_MS,
} from "@/lib/prazo-da-requisicao";

const U = "3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d";
const UUIDV4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PASTA = "https://loja.supabase.co/storage/v1/object/public/products/";
const MARCADA = `${PASTA}${U}-vw.jpg`;
const COPIAS_DA_ORIGEM = [`${U}-240.webp`, `${U}-480.webp`, `${U}-960.webp`];

describe("caminhoDaCopia preserva a marca", () => {
  it("foto marcada: o _copia_ entra ANTES da marca", () => {
    const copia = caminhoDaCopia(`${U}-vw.jpg`);
    expect(copia).toMatch(new RegExp(`^${U}_copia_${UUIDV4}-vw\\.jpg$`));
    expect(marcaDoNome(copia)?.marca).toBe("w");
  });

  it("cópia de cópia continua marcada (marca j)", () => {
    const primeira = caminhoDaCopia(`${U}-vj.PNG`);
    const segunda = caminhoDaCopia(primeira);
    expect(segunda).toMatch(
      new RegExp(`^${U}_copia_${UUIDV4}_copia_${UUIDV4}-vj\\.PNG$`),
    );
    expect(marcaDoNome(segunda)?.marca).toBe("j");
  });

  it("foto sem marca: o nome de hoje (o _copia_ no lugar da extensão)", () => {
    expect(caminhoDaCopia(`${U}.jpg`)).toMatch(
      new RegExp(`^${U}_copia_${UUIDV4}\\.jpg$`),
    );
    expect(caminhoDaCopia("pasta/foto.nome.jpg")).toMatch(
      new RegExp(`^pasta/foto\\.nome_copia_${UUIDV4}\\.jpg$`),
    );
  });

  it("marca dentro de pasta (backup/) não é marca: nome de hoje", () => {
    expect(caminhoDaCopia(`backup/${U}-vw.jpg`)).toMatch(
      new RegExp(`^backup/${U}-vw_copia_${UUIDV4}\\.jpg$`),
    );
  });

  it("caminhoDaCopiaSemMarca: sempre o nome de hoje, que não é lido como marcado", () => {
    const copia = caminhoDaCopiaSemMarca(`${U}-vw.jpg`);
    expect(copia).toMatch(new RegExp(`^${U}-vw_copia_${UUIDV4}\\.jpg$`));
    expect(marcaDoNome(copia)).toBeNull();
  });
});

describe("copiarImagemParaDuplicacao com foto marcada", () => {
  beforeEach(() => {
    vi.useRealTimers();
    h.copy.mockReset().mockResolvedValue({ data: {}, error: null });
    h.remove.mockReset().mockResolvedValue({ data: [], error: null });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("copia as 3 cópias primeiro e a original marcada por último", async () => {
    const url = await copiarImagemParaDuplicacao(MARCADA);

    expect(h.copy).toHaveBeenCalledTimes(4);
    const pares = h.copy.mock.calls.map(([de, para]) => [de, para] as const);
    const [deOriginal, paraOriginal] = pares[3];
    expect(deOriginal).toBe(`${U}-vw.jpg`);
    expect(paraOriginal).toMatch(new RegExp(`^${U}_copia_${UUIDV4}-vw\\.jpg$`));
    const base = paraOriginal.replace(/-vw\.jpg$/, "");
    expect(pares.slice(0, 3)).toEqual([
      [COPIAS_DA_ORIGEM[0], `${base}-240.webp`],
      [COPIAS_DA_ORIGEM[1], `${base}-480.webp`],
      [COPIAS_DA_ORIGEM[2], `${base}-960.webp`],
    ]);
    expect(url).toBe(`${PASTA}${paraOriginal}`);
    expect(marcaDe(url)).toBe("w");
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("a original só é copiada DEPOIS de as 3 cópias terminarem", async () => {
    const pendentes: Array<(v: unknown) => void> = [];
    h.copy.mockImplementation(
      (de: string) =>
        new Promise((resolve) => {
          if (de.endsWith("-vw.jpg")) resolve({ data: {}, error: null });
          else pendentes.push(resolve);
        }),
    );
    const copia = copiarImagemParaDuplicacao(MARCADA);
    await vi.waitFor(() => expect(pendentes).toHaveLength(3));
    expect(h.copy).toHaveBeenCalledTimes(3);
    for (const resolver of pendentes) resolver({ data: {}, error: null });
    expect(marcaDe(await copia)).toBe("w");
    expect(h.copy).toHaveBeenCalledTimes(4);
  });

  it("uma cópia falha: apaga as copiadas e a original vai SEM marca", async () => {
    h.copy.mockImplementation(async (de: string) =>
      de.endsWith("-480.webp")
        ? { data: null, error: { message: "não encontrado" } }
        : { data: {}, error: null },
    );
    const url = await copiarImagemParaDuplicacao(MARCADA);

    const destinos = h.copy.mock.calls.slice(0, 3).map(([, para]) => para);
    expect(h.remove).toHaveBeenCalledWith(destinos);
    const [de, para] = h.copy.mock.calls[3];
    expect(de).toBe(`${U}-vw.jpg`);
    expect(para).toMatch(new RegExp(`^${U}-vw_copia_${UUIDV4}\\.jpg$`));
    expect(marcaDe(url)).toBeNull();
    expect(url).toBe(`${PASTA}${para}`);
  });

  it("a original marcada falha: apaga as cópias copiadas e lança, como hoje", async () => {
    h.copy.mockImplementation(async (de: string) =>
      de.endsWith("-vw.jpg")
        ? { data: null, error: { message: "storage/unexpected_failure" } }
        : { data: {}, error: null },
    );
    await expect(copiarImagemParaDuplicacao(MARCADA)).rejects.toThrow(
      /storage\/unexpected_failure/,
    );
    const destinos = h.copy.mock.calls.slice(0, 3).map(([, para]) => para);
    expect(h.remove).toHaveBeenCalledWith(destinos);
  });

  it("rede sem resposta nas cópias: o erro 'sem resposta' sobe no prazo de UMA foto, nada marcado", async () => {
    vi.useFakeTimers();
    h.copy.mockImplementation(() => new Promise(() => {}));
    const copia = copiarImagemParaDuplicacao(MARCADA);
    const falha = expect(copia).rejects.toThrow(
      MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA,
    );
    await vi.advanceTimersByTimeAsync(PRAZO_DE_COPIAR_A_FOTO_PARA_DUPLICAR_MS);
    await falha;
    expect(h.copy).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("foto sem marca: uma cópia só, como hoje", async () => {
    const url = await copiarImagemParaDuplicacao(`${PASTA}${U}.jpg`);
    expect(h.copy).toHaveBeenCalledTimes(1);
    expect(marcaDe(url)).toBeNull();
  });

  it("marcada com consulta (?v=): na dúvida, a cópia de hoje (sem marca)", async () => {
    const url = await copiarImagemParaDuplicacao(`${MARCADA}?v=2`);
    expect(h.copy).toHaveBeenCalledTimes(1);
    expect(marcaDe(url)).toBeNull();
  });
});
