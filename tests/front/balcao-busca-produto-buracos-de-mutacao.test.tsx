// @vitest-environment jsdom
//
// Buracos que a segunda caça por mutação achou na busca de produto do balcão
// (BuscaDeProduto). Cada caso nasceu de um defeito de UMA linha plantado no
// componente que os testes vizinhos deixaram passar. O componente é montado
// direto, com `buscarProdutos` e `despachar` dublados, e os dados são todos
// inventados:
//  · o item que vai para o cupom sai completo (chave, preço, quantidade,
//    estoque, foto, hora da leitura do estoque e hora do toque);
//  · variação com preço próprio ZERO é brinde e vale zero; sem preço próprio
//    herda o do produto; o nome da variação sai sem espaço sobrando;
//  · os valores em reais mostram sempre duas casas;
//  · a contagem "N de M" e o aviso de "Mostrando N de M";
//  · o relógio que marca a leitura acompanha o `agora` mais novo da tela;
//  · "Cadastrar produto" só existe quando a tela sabe navegar;
//  · o atraso do campo (300 ms) e a repetição da MESMA página/termo ao tentar
//    de novo.
import {
  BuscaDeProduto,
  type PaginaDeProdutosEncontrados,
  type ProdutoEncontradoNaBusca,
  type VarianteEncontradaNaBusca,
} from "@/components/admin/pdv/BuscaDeProduto";
import type { AcaoDaVenda } from "@/hooks/useVendaPresencial";
import type { View } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function variante(
  id: string,
  extra: Partial<VarianteEncontradaNaBusca> = {},
): VarianteEncontradaNaBusca {
  return {
    id,
    name: "Cor",
    value: id.toUpperCase(),
    price_override: null,
    stock_increment: 4,
    active: true,
    image_url: null,
    ...extra,
  };
}

function produto(
  id: string,
  extra: Partial<ProdutoEncontradoNaBusca> = {},
): ProdutoEncontradoNaBusca {
  return {
    id,
    nome: `Produto ${id}`,
    codigo: null,
    preco_venda: 10,
    estoque: 7,
    imagem_url: null,
    imagem_urls: null,
    product_variants: [],
    ...extra,
  };
}

describe("BuscaDeProduto: buracos de mutação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let buscarProdutos: ReturnType<
    typeof vi.fn<
      (termo: string, pagina: number) => Promise<PaginaDeProdutosEncontrados>
    >
  >;
  let despachar: ReturnType<typeof vi.fn<(acao: AcaoDaVenda) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    buscarProdutos = vi.fn(async () => ({ produtos: [], total: 0 }));
    despachar = vi.fn();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function avancar(ms = 0): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function montar(
    primeiraPagina: readonly ProdutoEncontradoNaBusca[],
    opcoes: {
      total?: number;
      agora?: () => number;
      onNavigate?: (view: View) => void;
      semAgora?: boolean;
    } = {},
  ): Promise<void> {
    buscarProdutos.mockResolvedValue({
      produtos: primeiraPagina,
      total: opcoes.total ?? primeiraPagina.length,
    });
    await renderizar(opcoes);
    await avancar();
  }

  async function renderizar(opcoes: {
    agora?: () => number;
    onNavigate?: (view: View) => void;
    semAgora?: boolean;
    visivel?: boolean;
  }): Promise<void> {
    await act(async () => {
      raiz.render(
        <BuscaDeProduto
          despachar={despachar}
          buscarProdutos={buscarProdutos}
          visivel={opcoes.visivel ?? true}
          {...(opcoes.semAgora ? {} : { agora: opcoes.agora ?? (() => 5000) })}
          {...(opcoes.onNavigate ? { onNavigate: opcoes.onNavigate } : {})}
        />,
      );
    });
  }

  async function digitar(valor: string, ms = 400): Promise<void> {
    const campo = document.getElementById(
      "busca-manual-de-produto",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await avancar(ms);
  }

  function linhaPorTexto(texto: string): HTMLButtonElement {
    const achado = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );
    if (!achado) throw new Error(`botão com "${texto}" não achado`);
    return achado as HTMLButtonElement;
  }

  async function tocar(el: HTMLElement): Promise<void> {
    await act(async () => {
      el.click();
    });
    await avancar();
  }

  const texto = () => hospedeiro.textContent ?? "";
  /** O contador do cabeçalho da lista ("2 de 20"), separado do aviso de baixo. */
  const cabecalho = () =>
    hospedeiro.querySelector("h3")?.parentElement?.textContent ?? "";

  describe("o item que vai para o cupom", () => {
    it("produto simples: sai completo, com a hora da LEITURA do estoque e a hora do TOQUE", async () => {
      let agora = 1000;
      await montar(
        [
          produto("a", {
            nome: "Caneca Prova",
            preco_venda: 12.5,
            estoque: 7,
            imagem_url: "https://exemplo.test/caneca.jpg",
          }),
        ],
        { agora: () => agora },
      );
      // A leitura foi às 1000; o toque, às 2000.
      agora = 2000;
      await tocar(linhaPorTexto("Caneca Prova"));

      expect(despachar).toHaveBeenCalledTimes(1);
      expect(despachar).toHaveBeenCalledWith({
        tipo: "item_adicionado_manualmente",
        item: {
          chave: "a::",
          productId: "a",
          variantId: null,
          nome: "Caneca Prova",
          variacao: null,
          preco: 12.5,
          quantidade: 1,
          estoque: 7,
          estoqueLidoEm: 1000,
          imagem: "https://exemplo.test/caneca.jpg",
        },
        em: 2000,
      });
    });

    it("variação: sai completa; preço próprio ZERO vale zero (brinde); estoque é o da variação; foto da variação", async () => {
      let agora = 1000;
      await montar(
        [
          produto("a", {
            nome: "Camisa Prova",
            preco_venda: 40,
            estoque: 99,
            imagem_url: "https://exemplo.test/produto.jpg",
            product_variants: [
              variante("p", {
                value: "Azul",
                price_override: 0,
                stock_increment: 3,
                image_url: "https://exemplo.test/azul.jpg",
              }),
              // Outra variação ativa: o estoque do item é o da escolhida (3),
              // nunca a soma das ativas (3 + 5).
              variante("m", { value: "Verde", stock_increment: 5 }),
            ],
          }),
        ],
        { agora: () => agora },
      );
      agora = 2000;
      await tocar(linhaPorTexto("Camisa Prova"));
      await tocar(linhaPorTexto("Cor Azul"));

      expect(despachar).toHaveBeenCalledTimes(1);
      expect(despachar).toHaveBeenCalledWith({
        tipo: "item_adicionado_manualmente",
        item: {
          chave: "a::p",
          productId: "a",
          variantId: "p",
          nome: "Camisa Prova",
          variacao: "Cor Azul",
          preco: 0,
          quantidade: 1,
          estoque: 3,
          estoqueLidoEm: 1000,
          imagem: "https://exemplo.test/azul.jpg",
        },
        em: 2000,
      });
    });

    it("variação sem preço próprio herda o do produto; sem foto própria usa a do produto; nome sem espaço sobrando", async () => {
      await montar([
        produto("a", {
          nome: "Camisa Prova",
          preco_venda: 40,
          imagem_url: "https://exemplo.test/produto.jpg",
          product_variants: [variante("p", { value: "", stock_increment: 5 })],
        }),
      ]);
      await tocar(linhaPorTexto("Camisa Prova"));
      await tocar(linhaPorTexto("Cor"));

      expect(despachar).toHaveBeenCalledTimes(1);
      expect(despachar.mock.calls[0]?.[0]).toMatchObject({
        item: {
          preco: 40,
          variacao: "Cor",
          imagem: "https://exemplo.test/produto.jpg",
        },
      });
    });

    it("sem a prop `agora`, a hora do toque é a do relógio do aparelho", async () => {
      vi.setSystemTime(new Date("2031-05-06T10:00:00Z"));
      const lidoEm = Date.now();
      await montar([produto("a")], { semAgora: true });
      vi.setSystemTime(new Date("2031-05-06T10:05:00Z"));
      const toqueEm = Date.now();
      await tocar(linhaPorTexto("Produto a"));

      expect(despachar.mock.calls[0]?.[0]).toMatchObject({
        item: { estoqueLidoEm: lidoEm },
        em: toqueEm,
      });
    });

    it("o relógio da leitura acompanha o `agora` MAIS NOVO da tela (troca de prop entre buscas)", async () => {
      await montar([produto("a")], { agora: () => 1000 });
      await renderizar({ agora: () => 3000 });
      await avancar();

      await digitar("ab");
      await tocar(linhaPorTexto("Produto a"));

      expect(despachar.mock.calls[0]?.[0]).toMatchObject({
        item: { estoqueLidoEm: 3000 },
        em: 3000,
      });
    });
  });

  describe("textos e valores", () => {
    it("o preço sempre mostra duas casas, no produto e na variação, e o preço próprio ZERO aparece como R$ 0,00", async () => {
      await montar([
        produto("simples", { preco_venda: 12.5, estoque: 7 }),
        produto("inteiro", { preco_venda: 10, estoque: 2 }),
        produto("grade", {
          preco_venda: 1234.5,
          product_variants: [
            variante("p", { price_override: 0, stock_increment: 3 }),
            variante("m", { price_override: null, stock_increment: 4 }),
            variante("g", { price_override: 8.9, stock_increment: 5 }),
          ],
        }),
      ]);
      expect(linhaPorTexto("Produto simples").textContent).toContain(
        "R$ 12,50 · 7 em estoque",
      );
      expect(linhaPorTexto("Produto inteiro").textContent).toContain(
        "R$ 10,00 · 2 em estoque",
      );

      await tocar(linhaPorTexto("Produto grade"));
      expect(linhaPorTexto("Cor P").textContent).toContain(
        "R$ 0,00 · 3 em estoque",
      );
      expect(linhaPorTexto("Cor M").textContent).toContain(
        "R$ 1.234,50 · 4 em estoque",
      );
      expect(linhaPorTexto("Cor G").textContent).toContain(
        "R$ 8,90 · 5 em estoque",
      );
    });

    it("o cabeçalho conta 'N de M' e, com mais produtos do que cabem, avisa 'Mostrando N de M'", async () => {
      await montar([produto("a"), produto("b")], { total: 20 });
      expect(cabecalho()).toContain("2 de 20");
      expect(texto()).toContain("Mostrando 2 de 20.");
    });

    it("com todos na tela, o cabeçalho conta 'N de N' e não há aviso nem 'Mostrar mais'", async () => {
      await montar([produto("a"), produto("b")]);
      expect(cabecalho()).toContain("2 de 2");
      expect(texto()).not.toContain("Mostrando");
      expect(texto()).not.toContain("Mostrar mais");
    });

    it("dois produtos com o mesmo nome convivem sem chave repetida e cada um adiciona o seu", async () => {
      const erro = vi.spyOn(console, "error").mockImplementation(() => {});
      await montar([
        produto("a", { nome: "Camiseta Igual" }),
        produto("b", { nome: "Camiseta Igual" }),
      ]);
      const linhas = [...hospedeiro.querySelectorAll("li button")];
      expect(linhas).toHaveLength(2);
      await tocar(linhas[1] as HTMLElement);
      expect(despachar.mock.calls[0]?.[0]).toMatchObject({
        item: { productId: "b" },
      });
      expect(erro).not.toHaveBeenCalled();
    });
  });

  describe("lista de produtos", () => {
    it("as variações só aparecem depois do toque no produto e somem no segundo toque", async () => {
      await montar([
        produto("a", {
          product_variants: [variante("p"), variante("m")],
        }),
      ]);
      const temVariacoes = () =>
        texto().includes("Cor P") || texto().includes("Cor M");
      expect(temVariacoes()).toBe(false);
      await tocar(linhaPorTexto("Produto a"));
      expect(temVariacoes()).toBe(true);
      await tocar(linhaPorTexto("Produto a"));
      expect(temVariacoes()).toBe(false);
    });

    it("só o produto com variação ativa é 'expansível': o simples não leva aria-expanded", async () => {
      await montar([
        produto("simples"),
        produto("grade", { product_variants: [variante("p")] }),
      ]);
      expect(
        linhaPorTexto("Produto simples").hasAttribute("aria-expanded"),
      ).toBe(false);
      expect(linhaPorTexto("Produto grade").getAttribute("aria-expanded")).toBe(
        "false",
      );
    });

    it("estoque zero fica em vermelho; com estoque, não", async () => {
      await montar([
        produto("zero", { estoque: 0 }),
        produto("um", { estoque: 1 }),
      ]);
      const cor = (nome: string, frase: string) =>
        // O span mais interno que traz a frase (os de fora a contêm também).
        [...linhaPorTexto(nome).querySelectorAll("span")]
          .filter((s) => s.textContent?.includes(frase))
          .at(-1)?.className ?? "";
      expect(cor("Produto zero", "Sem estoque")).toContain("pdv-red");
      expect(cor("Produto um", "1 em estoque")).not.toContain("pdv-red");
    });
  });

  describe("estado vazio", () => {
    it("antes de a tela ficar visível (nada consultado ainda) não diz que o catálogo está vazio", async () => {
      await renderizar({ visivel: false });
      await avancar();
      expect(buscarProdutos).not.toHaveBeenCalled();
      expect(texto()).not.toContain("Nenhum produto");
    });

    it("com uma busca nova a caminho, a frase da busca anterior sem resultado sai da tela", async () => {
      await montar([]);
      await digitar("zzz");
      expect(texto()).toContain("Nenhum produto encontrado");
      expect(texto()).toContain('Sem resultado para "zzz"');

      buscarProdutos.mockReturnValueOnce(new Promise(() => {}));
      await digitar("zzzz");
      expect(texto()).toContain("Buscando…");
      expect(texto()).not.toContain("Nenhum produto encontrado");
    });
  });

  describe("catálogo vazio", () => {
    it("sem `onNavigate` a tela diz que não há produto, mas não oferece 'Cadastrar produto'", async () => {
      await montar([]);
      expect(texto()).toContain("Nenhum produto ativo cadastrado");
      expect(texto()).not.toContain("Cadastrar produto");
      // Sem produto, não há lista nem cabeçalho "Produtos 0 de 0".
      expect(hospedeiro.querySelector("ul")).toBeNull();
      expect(hospedeiro.querySelector("h3")).toBeNull();
    });

    it("com `onNavigate`, 'Cadastrar produto' abre o formulário de produto", async () => {
      const navegar = vi.fn();
      await montar([], { onNavigate: navegar });
      await tocar(linhaPorTexto("Cadastrar produto"));
      expect(navegar).toHaveBeenCalledTimes(1);
      expect(navegar).toHaveBeenCalledWith("admin-product-form");
    });
  });

  describe("atraso e nova tentativa", () => {
    it("a busca por nome só sai depois de 300 ms parado", async () => {
      await montar([produto("a")]);
      expect(buscarProdutos).toHaveBeenCalledTimes(1);
      await digitar("ab", 299);
      expect(buscarProdutos).toHaveBeenCalledTimes(1);
      await avancar(1);
      expect(buscarProdutos).toHaveBeenCalledTimes(2);
      expect(buscarProdutos).toHaveBeenLastCalledWith("ab", 0);
    });

    it("'Mostrar mais' pede a página seguinte, e a seguinte da seguinte, sempre do MESMO termo", async () => {
      await montar([produto("a")], { total: 30 });
      await digitar("ab");
      buscarProdutos.mockResolvedValue({
        produtos: [produto("b")],
        total: 30,
      });
      await tocar(linhaPorTexto("Mostrar mais"));
      expect(buscarProdutos).toHaveBeenLastCalledWith("ab", 1);
      buscarProdutos.mockResolvedValue({
        produtos: [produto("c")],
        total: 30,
      });
      await tocar(linhaPorTexto("Mostrar mais"));
      expect(buscarProdutos).toHaveBeenLastCalledWith("ab", 2);
    });

    it("lista base ainda a caminho: o campo entregar um texto curto não dispara outra consulta", async () => {
      buscarProdutos.mockReturnValue(new Promise(() => {}));
      await renderizar({});
      await avancar();
      expect(buscarProdutos).toHaveBeenCalledTimes(1);
      expect(texto()).toContain("Buscando…");

      await digitar("a");
      expect(buscarProdutos).toHaveBeenCalledTimes(1);
    });

    it("a resposta de uma busca VELHA não apaga o 'Buscando…' da busca nova que ainda espera", async () => {
      await montar([produto("a")]);
      let resolverVelha!: (pagina: PaginaDeProdutosEncontrados) => void;
      buscarProdutos.mockReturnValueOnce(
        new Promise<PaginaDeProdutosEncontrados>((resolve) => {
          resolverVelha = resolve;
        }),
      );
      buscarProdutos.mockReturnValueOnce(new Promise(() => {}));
      await digitar("ab");
      await digitar("abc");
      expect(texto()).toContain("Buscando…");

      await act(async () => {
        resolverVelha({ produtos: [produto("velho")], total: 1 });
      });
      await avancar();

      expect(texto()).toContain("Buscando…");
      expect(texto()).not.toContain("Produto velho");
    });

    it("página seguinte que só traz produto repetido fecha a conta: 'N de N' e some o 'Mostrar mais'", async () => {
      await montar([produto("a"), produto("b")], { total: 30 });
      expect(cabecalho()).toContain("2 de 30");
      // O catálogo mudou no meio do caminho: a página 2 só devolve o que já
      // está na tela. Oferecer outro "Mostrar mais" seria um botão que não traz nada.
      buscarProdutos.mockResolvedValue({
        produtos: [produto("a"), produto("b")],
        total: 30,
      });
      await tocar(linhaPorTexto("Mostrar mais"));
      expect(cabecalho()).toContain("2 de 2");
      expect(texto()).not.toContain("Mostrar mais");
      expect(texto()).not.toContain("Mostrando");
    });

    it("total menor que o que já está na tela (catálogo encolheu) nunca mostra 'N de M' com M menor que N", async () => {
      await montar([produto("a"), produto("b")], { total: 20 });
      buscarProdutos.mockResolvedValue({
        produtos: [produto("c"), produto("d"), produto("e")],
        total: 3,
      });
      await tocar(linhaPorTexto("Mostrar mais"));
      expect(cabecalho()).toContain("5 de 5");
      expect(texto()).not.toContain("5 de 3");
      expect(texto()).not.toContain("Mostrar mais");
    });

    it("a primeira página com total menor que a lista também mostra 'N de N'", async () => {
      await montar([produto("a"), produto("b")], { total: 1 });
      expect(cabecalho()).toContain("2 de 2");
    });

    it("falha da página 2: 'Tentar de novo' repete a página 2 do MESMO termo e some com o alerta", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await montar([produto("a")], { total: 30 });
      await digitar("ab");
      buscarProdutos.mockRejectedValueOnce(new Error("rede"));
      await tocar(linhaPorTexto("Mostrar mais"));
      expect(texto()).toContain("Falha na busca de produtos");
      // Com a falha na tela, quem pede de novo é o "Tentar de novo": o "Mostrar
      // mais" e o aviso de "Mostrando N de M" saem de cena.
      expect(texto()).not.toContain("Mostrar mais");
      expect(texto()).not.toContain("Mostrando");

      buscarProdutos.mockResolvedValueOnce({
        produtos: [produto("b")],
        total: 30,
      });
      await tocar(linhaPorTexto("Tentar de novo"));
      expect(buscarProdutos).toHaveBeenLastCalledWith("ab", 1);
      expect(texto()).not.toContain("Falha na busca de produtos");
      expect(texto()).toContain("Produto b");
    });
  });
});
