// Dois buracos medidos na busca da vitrine, os dois de quem digita pelo celular:
// 1) apostrofo: o teclado do iPhone digita o apostrofo CURVO ("d’agua", pontuacao
//    inteligente); o cadastro pode ter o reto ("d'agua") e vice-versa. A
//    pontuacao do MEIO da palavra ficava literal, entao um nao achava o outro.
//    Agora o apostrofo some dos dois lados antes de comparar.
// 2) plural em -il: "refil" faz "refis", "funil" faz "funis". Quem digita o
//    plural ja achava o singular (tirar o "s" deixa "refi", que esta dentro de
//    "refil"); faltava o caminho de volta: "refil" nao achava "Refis".
import {
  pontuadorDaBusca,
  produtoCombinaComBusca,
} from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const produto = (name: string, category = "Geral", description?: string) => ({
  name,
  category,
  description: description ?? null,
});

describe("apostrofo reto e curvo sao a mesma coisa na busca", () => {
  it.each([
    ["caixa d'agua", "Caixa d’água"],
    ["caixa d’agua", "Caixa d'água"],
    ["caixa d‘agua", "Caixa d'água"],
    ["caixa dʼagua", "Caixa d’água"],
    ["caixa d´agua", "Caixa d’água"],
    ["caixa d`agua", "Caixa d’água"],
    ["caixa d'agua", "Caixa d'água"],
    ["caixa dagua", "Caixa d’água"],
    ["caixa d'agua", "Caixa dagua"],
    ["o'brien", "Perfume O’Brien"],
    ["o’brien", "Perfume O'Brien"],
  ])("%s acha %s", (busca, nome) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it("vale na categoria e na descricao", () => {
    expect(
      produtoCombinaComBusca(produto("Reservatório", "Caixa d’água"), "d'agua"),
    ).toBe(true);
    expect(
      produtoCombinaComBusca(
        produto("Reservatório", "Casa", "Boa para caixa d’água de 500 litros"),
        "caixa d'agua",
      ),
    ).toBe(true);
  });

  it("a relevancia da caixinha tambem enxerga o apostrofo curvo", () => {
    const pontuar = pontuadorDaBusca("caixa d'agua");
    expect(pontuar(produto("Caixa d’água 500L"))).toBeGreaterThan(0);
    expect(pontuar(produto("Bolsa Grande"))).toBe(0);
  });

  it("continua exigindo TODAS as palavras e nao acha o que nao e o produto", () => {
    expect(
      produtoCombinaComBusca(produto("Caixa Grande"), "caixa d'agua"),
    ).toBe(false);
    expect(
      produtoCombinaComBusca(produto("Perfume O’Brien"), "o'brien azul"),
    ).toBe(false);
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "d'agua")).toBe(
      false,
    );
  });
});

describe("plural em -il: refil/refis, funil/funis, fuzil/fuzis", () => {
  it.each([
    ["refis", "Refil de Sabonete"],
    ["refil", "Refis de Sabonete"],
    ["funis", "Funil Grande"],
    ["funil", "Funis de Inox"],
    ["fuzis", "Fuzil de Brinquedo"],
    ["fuzil", "Fuzis de Brinquedo"],
  ])("%s acha %s", (busca, nome) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it("vale em frase e na categoria", () => {
    expect(
      produtoCombinaComBusca(produto("Sabonete Líquido", "Refis"), "refil"),
    ).toBe(true);
    expect(
      produtoCombinaComBusca(
        produto("Refil de Sabonete Líquido"),
        "refis sabonete",
      ),
    ).toBe(true);
  });

  it("nao acha o que nao e o par dele", () => {
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "refis")).toBe(
      false,
    );
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "refil")).toBe(
      false,
    );
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "funis")).toBe(
      false,
    );
  });

  it("o -is do cadastro vale como palavra inteira: refil nao acha Prefisos", () => {
    expect(produtoCombinaComBusca(produto("Prefisos"), "refil")).toBe(false);
  });

  it("palavras que terminam em s e nao sao plural continuam do jeito que eram", () => {
    expect(produtoCombinaComBusca(produto("Lápis de Olho"), "lapis")).toBe(
      true,
    );
    expect(
      produtoCombinaComBusca(produto("Ônibus de Brinquedo"), "onibus"),
    ).toBe(true);
    expect(produtoCombinaComBusca(produto("Botijão de Gas"), "gas")).toBe(true);
    expect(produtoCombinaComBusca(produto("Tênis Branco"), "tenis")).toBe(true);
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "lapis")).toBe(
      false,
    );
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "onibus")).toBe(
      false,
    );
    expect(produtoCombinaComBusca(produto("Garrafa Termica"), "gas")).toBe(
      false,
    );
    // Palavra curta em -il nao e mexida: "mil" nao vira "mis".
    expect(produtoCombinaComBusca(produto("Mis en Place"), "mil")).toBe(false);
  });
});
