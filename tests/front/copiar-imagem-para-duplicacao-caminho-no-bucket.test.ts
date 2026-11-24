// Caça de provas fracas (mutação) em `caminhoDaImagemDoProduto`, 24/11/2026.
// Duplicar produto copia o ARQUIVO atrás de cada foto; se o caminho sair
// errado, a cópia aponta para o arquivo de outro bucket ou para um que não
// existe, e a foto some da vitrine sem erro nenhum. Os testes de duplicação
// provavam o caminho feliz, o placeholder externo e o vazio, e sobreviviam:
//
//  - "products" de OUTRO bucket (".../public/outro/products/x.jpg");
//  - o aviso de "placeholder" pelo nome, sem o host placehold.co (e o host sem
//    a palavra no caminho);
//  - nome de arquivo com espaço ou acento, que chega codificado na URL
//    (%20) e precisa voltar ao nome REAL do objeto para o storage achá-lo.
import { caminhoDaImagemDoProduto } from "@/lib/copiar-imagem-para-duplicacao";
import { describe, expect, it } from "vitest";

const BUCKET = "https://loja.supabase.co/storage/v1/object/public/products/";

describe("caminhoDaImagemDoProduto — o caminho do objeto no bucket products", () => {
  it("devolve o nome do objeto, com pasta quando houver", () => {
    expect(caminhoDaImagemDoProduto(`${BUCKET}abc.jpg`)).toBe("abc.jpg");
    expect(caminhoDaImagemDoProduto(`${BUCKET}pasta/abc.jpg`)).toBe(
      "pasta/abc.jpg",
    );
  });

  it("decodifica o nome: %20 volta a espaço e %C3%A9 volta a 'é'", () => {
    expect(caminhoDaImagemDoProduto(`${BUCKET}foto%20nova.jpg`)).toBe(
      "foto nova.jpg",
    );
    expect(caminhoDaImagemDoProduto(`${BUCKET}caf%C3%A9.png`)).toBe("café.png");
  });

  it("bucket de OUTRO nome que só termina em 'products' não é o nosso", () => {
    expect(
      caminhoDaImagemDoProduto(
        "https://loja.supabase.co/storage/v1/object/public/outro/products/abc.jpg",
      ),
    ).toBeNull();
  });

  it("marcador de imagem é recusado pelo host e também pela palavra 'placeholder'", () => {
    // Host placehold.co mesmo com o trecho do bucket no caminho.
    expect(
      caminhoDaImagemDoProduto(
        "https://placehold.co/public/products/600x400.png",
      ),
    ).toBeNull();
    // A palavra "placeholder" no endereço do bucket.
    expect(
      caminhoDaImagemDoProduto(`${BUCKET}placeholder-produto.png`),
    ).toBeNull();
  });
});
