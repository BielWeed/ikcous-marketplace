// @vitest-environment jsdom
//
// Bordas da lista de busca do balcão (BuscaDeProduto) que a caça por mutação
// achou soltas. O componente é montado direto, só com `buscarProdutos` e
// `despachar` dublados:
//  · o mínimo é de 2 letras: "a" não busca, "ab" busca (e "a" depois de "ab"
//    volta para a lista base);
//  · a foto cai para a primeira da galeria quando a principal falta;
//  · variação desligada não conta: produto só com variação desligada entra pelo
//    estoque do PRÓPRIO produto, e o texto diz "1 variação" no singular;
//  · variação com estoque zero fica desabilitada e diz "Esgotado";
//  · tocar duas vezes no produto com variações abre e FECHA a lista;
//  · depois de adicionar, o foco volta para o campo de busca (o balconista
//    segue digitando sem pegar o mouse);
//  · estoque zero do produto simples diz "Sem estoque" (não "0 em estoque");
//  · o mesmo termo depois de uma falha da página seguinte busca de novo (a
//    falha não trava o campo).
import {
  BuscaDeProduto,
  type PaginaDeProdutosEncontrados,
  type ProdutoEncontradoNaBusca,
  type VarianteEncontradaNaBusca,
} from "@/components/admin/pdv/BuscaDeProduto";
import type { AcaoDaVenda } from "@/hooks/useVendaPresencial";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function variante(
  id: string,
  estoque: number,
  ativa = true,
): VarianteEncontradaNaBusca {
  return {
    id,
    name: "Tamanho",
    value: id.toUpperCase(),
    price_override: null,
    stock_increment: estoque,
    active: ativa,
    image_url: null,
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

describe("BuscaDeProduto: bordas da lista", () => {
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
    total = primeiraPagina.length,
  ): Promise<void> {
    buscarProdutos.mockResolvedValue({ produtos: primeiraPagina, total });
    await act(async () => {
      raiz.render(
        <BuscaDeProduto
          despachar={despachar}
          buscarProdutos={buscarProdutos}
          visivel
          agora={() => 5000}
        />,
      );
    });
    await avancar();
  }

  async function digitar(valor: string): Promise<void> {
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
    // O campo só entrega o texto depois de 300 ms parado.
    await avancar(400);
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

  it("uma letra não busca; duas letras buscam o termo; voltar a uma letra volta para a lista base", async () => {
    await montar([produto("a")]);
    expect(buscarProdutos).toHaveBeenCalledTimes(1);
    expect(buscarProdutos).toHaveBeenLastCalledWith("", 0);

    await digitar("a");
    // "a" é menos que 2 letras: continua a lista base, sem nova consulta.
    expect(buscarProdutos).toHaveBeenCalledTimes(1);

    await digitar("ab");
    expect(buscarProdutos).toHaveBeenCalledTimes(2);
    expect(buscarProdutos).toHaveBeenLastCalledWith("ab", 0);

    await digitar("a");
    expect(buscarProdutos).toHaveBeenCalledTimes(3);
    expect(buscarProdutos).toHaveBeenLastCalledWith("", 0);
  });

  it("termo com espaços nas pontas busca sem os espaços", async () => {
    await montar([produto("a")]);
    await digitar("  vestido  ");
    expect(buscarProdutos).toHaveBeenLastCalledWith("vestido", 0);
  });

  it("sem foto principal, mostra a primeira da galeria", async () => {
    await montar([
      produto("a", {
        imagem_url: null,
        imagem_urls: ["https://exemplo.test/galeria-1.jpg"],
      }),
    ]);
    const imagem = hospedeiro.querySelector("img");
    expect(imagem?.getAttribute("src")).toContain("galeria-1.jpg");
  });

  it("produto só com variação DESLIGADA entra pelo estoque do próprio produto", async () => {
    await montar([
      produto("a", {
        estoque: 7,
        product_variants: [variante("p", 50, false)],
      }),
    ]);
    // Não tem variação ativa: não há "variação" na linha, e o toque adiciona.
    expect(hospedeiro.textContent).not.toContain("variaç");
    await tocar(linhaPorTexto("Produto a"));
    expect(despachar).toHaveBeenCalledTimes(1);
    expect(despachar.mock.calls[0]?.[0]).toMatchObject({
      tipo: "item_adicionado_manualmente",
      item: { productId: "a", variantId: null, estoque: 7, quantidade: 1 },
    });
  });

  it("produto com UMA variação ativa diz '1 variação'; com duas, '2 variações'", async () => {
    await montar([
      produto("um", {
        product_variants: [variante("p", 3), variante("x", 9, false)],
      }),
      produto("dois", {
        product_variants: [variante("p", 3), variante("m", 4)],
      }),
    ]);
    expect(linhaPorTexto("Produto um").textContent).toContain("1 variação");
    expect(linhaPorTexto("Produto um").textContent).not.toContain(
      "1 variações",
    );
    expect(linhaPorTexto("Produto dois").textContent).toContain("2 variações");
  });

  it("variação com estoque ZERO fica desabilitada e diz 'Esgotado'; a com estoque entra com o estoque dela", async () => {
    await montar([
      produto("a", {
        estoque: 99,
        product_variants: [variante("p", 0), variante("m", 4)],
      }),
    ]);
    await tocar(linhaPorTexto("Produto a"));

    const esgotada = linhaPorTexto("Tamanho P");
    expect(esgotada.disabled).toBe(true);
    expect(esgotada.textContent).toContain("Esgotado");

    const comEstoque = linhaPorTexto("Tamanho M");
    expect(comEstoque.disabled).toBe(false);
    await tocar(comEstoque);
    expect(despachar).toHaveBeenCalledTimes(1);
    expect(despachar.mock.calls[0]?.[0]).toMatchObject({
      tipo: "item_adicionado_manualmente",
      item: { productId: "a", variantId: "m", estoque: 4, quantidade: 1 },
    });
  });

  it("tocar duas vezes no produto com variações abre e depois FECHA a lista", async () => {
    await montar([
      produto("a", { product_variants: [variante("p", 3), variante("m", 4)] }),
    ]);
    expect(linhaPorTexto("Produto a").getAttribute("aria-expanded")).toBe(
      "false",
    );
    await tocar(linhaPorTexto("Produto a"));
    expect(linhaPorTexto("Produto a").getAttribute("aria-expanded")).toBe(
      "true",
    );
    await tocar(linhaPorTexto("Produto a"));
    expect(linhaPorTexto("Produto a").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("depois de adicionar um produto simples, o foco volta para o campo de busca", async () => {
    await montar([produto("a")]);
    const campo = document.getElementById("busca-manual-de-produto");
    linhaPorTexto("Produto a").focus();
    expect(document.activeElement).not.toBe(campo);

    await tocar(linhaPorTexto("Produto a"));

    expect(despachar).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(campo);
  });

  it("produto simples com estoque 0 diz 'Sem estoque'; com 3 diz '3 em estoque'", async () => {
    await montar([
      produto("zero", { estoque: 0 }),
      produto("tres", { estoque: 3 }),
    ]);
    expect(linhaPorTexto("Produto zero").textContent).toContain("Sem estoque");
    expect(linhaPorTexto("Produto zero").textContent).not.toContain(
      "0 em estoque",
    );
    expect(linhaPorTexto("Produto tres").textContent).toContain("3 em estoque");
  });

  it("falha na página seguinte: o MESMO termo ao sair do campo refaz a busca em vez de ficar travado", async () => {
    await montar([produto("a")], 20);
    await digitar("ab");
    expect(buscarProdutos).toHaveBeenLastCalledWith("ab", 0);

    // "Mostrar mais" falha (rede).
    vi.spyOn(console, "error").mockImplementation(() => {});
    buscarProdutos.mockRejectedValueOnce(new Error("rede caiu"));
    await tocar(linhaPorTexto("Mostrar mais"));
    expect(buscarProdutos).toHaveBeenLastCalledWith("ab", 1);
    expect(hospedeiro.textContent).toContain("Falha na busca de produtos");

    // O campo entrega o MESMO texto ao perder o foco: com a falha pendente,
    // tem de buscar de novo (termo que falhou pode ser buscado outra vez).
    const chamadasAntes = buscarProdutos.mock.calls.length;
    const campo = document.getElementById(
      "busca-manual-de-produto",
    ) as HTMLInputElement;
    await act(async () => {
      campo.focus();
      campo.blur();
    });
    await avancar(400);
    expect(buscarProdutos.mock.calls.length).toBe(chamadasAntes + 1);
    expect(buscarProdutos).toHaveBeenLastCalledWith("ab", 0);
  });
});
