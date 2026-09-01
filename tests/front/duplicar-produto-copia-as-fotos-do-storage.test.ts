// Laudo 0109 (A2): duplicar produto reusava as MESMAS URLs do Storage, e a
// exclusão futura da cópia movia os arquivos físicos para backup/ — as fotos
// do ORIGINAL sumiam da vitrine sem erro em lugar nenhum. A cura é no
// nascimento da cópia: cada imagem ganha arquivo próprio (`_copia_<uuid>`).
//
// Este arquivo prende o helper de cópia:
//   1. URL do bucket `products` → storage.copy é chamado do caminho original
//      para um caminho NOVO, e a URL pública da cópia volta;
//   2. URL que não tem arquivo nosso atrás (placeholder, domínio externo,
//      outro bucket) → volta como está, sem tocar no storage;
//   3. falha de cópia → LANÇA (o chamador tem catch com toast; melhor não
//      duplicar do que nascer compartilhando arquivo de novo em silêncio).
import { beforeEach, describe, expect, it, vi } from "vitest";

const copy = vi.fn();
const getPublicUrl = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: () => ({
        copy: (...args: unknown[]) => copy(...args),
        getPublicUrl: (...args: unknown[]) => getPublicUrl(...args),
      }),
    },
  },
}));

import { copiarImagemParaDuplicacao } from "@/hooks/useProducts";
import {
  caminhoDaCopia,
  caminhoDaImagemDoProduto,
} from "@/lib/copiar-imagem-para-duplicacao";

const URL_DO_BUCKET =
  "https://proj.supabase.co/storage/v1/object/public/products/abc-foto.jpg";

describe("caminhoDaImagemDoProduto", () => {
  it("extrai o caminho de URL do bucket products", () => {
    expect(caminhoDaImagemDoProduto(URL_DO_BUCKET)).toBe("abc-foto.jpg");
  });

  it("devolve null para placeholder, URL externa e vazio", () => {
    expect(
      caminhoDaImagemDoProduto("https://placehold.co/600x400.png"),
    ).toBeNull();
    expect(
      caminhoDaImagemDoProduto("https://cdn.algum.com/foto.jpg"),
    ).toBeNull();
    expect(
      caminhoDaImagemDoProduto(
        "https://proj.supabase.co/storage/v1/object/public/banners/x.jpg",
      ),
    ).toBeNull();
    expect(caminhoDaImagemDoProduto("")).toBeNull();
  });
});

describe("caminhoDaCopia", () => {
  it("mete o sufixo _copia_ no lugar da extensão", () => {
    const copia = caminhoDaCopia("pasta/foto.nome.jpg");
    expect(copia).toMatch(/^pasta\/foto\.nome_copia_[0-9a-f-]{36}\.jpg$/);
  });

  it("gera caminhos diferentes a cada chamada", () => {
    expect(caminhoDaCopia("a.jpg")).not.toBe(caminhoDaCopia("a.jpg"));
  });
});

describe("copiarImagemParaDuplicacao", () => {
  beforeEach(() => {
    copy.mockReset();
    getPublicUrl.mockReset();
  });

  it("copia o arquivo para um caminho novo e devolve a URL pública da cópia", async () => {
    copy.mockResolvedValue({
      data: { path: "abc-foto.jpg_copia_x.jpg" },
      error: null,
    });
    getPublicUrl.mockReturnValue({
      data: {
        publicUrl:
          "https://proj.supabase.co/storage/v1/object/public/products/abc-foto.jpg_copia_x.jpg",
      },
    });

    const url = await copiarImagemParaDuplicacao(URL_DO_BUCKET);

    expect(copy).toHaveBeenCalledTimes(1);
    const [de, para] = copy.mock.calls[0];
    expect(de).toBe("abc-foto.jpg");
    expect(para).toMatch(/^abc-foto_copia_[0-9a-f-]{36}\.jpg$/);
    expect(url).toContain("abc-foto.jpg_copia_x.jpg");
  });

  it("não toca no storage para URL sem arquivo nosso", async () => {
    const url = "https://placehold.co/600x400.png";
    expect(await copiarImagemParaDuplicacao(url)).toBe(url);
    expect(copy).not.toHaveBeenCalled();
  });

  it("lança quando a cópia falha — duplicação não nasce compartilhando arquivo", async () => {
    copy.mockResolvedValue({
      data: null,
      error: { message: "storage/unexpected_failure" },
    });
    await expect(copiarImagemParaDuplicacao(URL_DO_BUCKET)).rejects.toThrow(
      /storage\/unexpected_failure/,
    );
  });
});
