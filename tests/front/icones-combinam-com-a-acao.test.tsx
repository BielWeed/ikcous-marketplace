import { readFileSync } from "node:fs";
import { join } from "node:path";
// @vitest-environment jsdom
//
// Os símbolos dos botões dizem a verdade sobre o que o toque faz:
//   - seta para baixo/cima só quando a lista abre NO LUGAR (e ela gira ao abrir);
//   - folha, diálogo e navegação interna usam seta para a direita;
//   - "abrir fora do app" não aparece onde a navegação é dentro do app;
//   - lápis é só para editar (Salvar usa o "certo").
/* eslint-disable security/detect-non-literal-fs-filename --
   a prova estática lê arquivos-fonte de caminho fixo no repositório */
import { BuscaDeProduto } from "@/components/admin/pdv/BuscaDeProduto";
import { CampoDeCategoria } from "@/components/admin/products/CampoDeCategoria";
import { esquecerOsIconesPeloNome } from "@/hooks/useIconesPeloNome";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fonte(caminho: string): string {
  return readFileSync(join(__dirname, "..", "..", caminho), "utf8");
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  esquecerOsIconesPeloNome();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("sem rede no teste");
    }),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ícones combinam com a ação", () => {
  it("o botão 'Escolher categoria' (abre uma folha) mostra seta para a direita", async () => {
    await act(async () => {
      raiz.render(
        <CampoDeCategoria
          valor=""
          nomes={[{ id: "1", nome: "Calçados" }]}
          aoEscolher={vi.fn()}
          aoCriar={vi.fn()}
          aoGerenciar={vi.fn()}
          categoriaDoRascunhoQueSumiu={null}
        />,
      );
    });
    const botao = document.getElementById("product-category")!;
    expect(botao.querySelector("svg.lucide-chevron-right")).not.toBeNull();
    expect(botao.querySelector("svg.lucide-chevron-down")).toBeNull();
  });

  it("o rótulo 'Categoria' não fica por cima do botão: o CSS reserva o topo", () => {
    const css = fonte("src/components/admin/products/formulario-produto.css");
    expect(css).toMatch(
      /\.produto-formulario\s+\.produto-campo\s*>\s*#product-category\s*\{[^}]*padding-top:\s*30px/,
    );
  });

  it("a seta da busca do balcão gira quando as variações abrem", async () => {
    const buscarProdutos = vi.fn().mockResolvedValue({
      produtos: [
        {
          id: "p1",
          nome: "Vestido",
          preco_venda: 100,
          estoque: 0,
          imagem_url: null,
          imagem_urls: null,
          product_variants: [
            {
              id: "v1",
              name: "Tam",
              value: "M",
              price_override: null,
              stock_increment: 3,
              active: true,
              image_url: null,
            },
          ],
        },
      ],
      total: 1,
    });
    await act(async () => {
      raiz.render(
        <BuscaDeProduto
          visivel
          despachar={vi.fn()}
          buscarProdutos={buscarProdutos}
        />,
      );
    });
    const linha = document.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    )!;
    expect(linha.getAttribute("aria-expanded")).toBe("false");
    expect(
      linha.querySelector("svg.lucide-chevron-down")!.getAttribute("class"),
    ).not.toContain("rotate-180");
    await act(async () => {
      linha.click();
    });
    expect(linha.getAttribute("aria-expanded")).toBe("true");
    expect(
      linha.querySelector("svg.lucide-chevron-down")!.getAttribute("class"),
    ).toContain("rotate-180");
  });

  it("as fontes não têm mais os símbolos errados nos trechos trocados", () => {
    const periodo = fonte(
      "src/components/admin/financeiro/SeletorDePeriodo.tsx",
    );
    expect(periodo).not.toMatch(/ChevronDown/);

    const checkout = fonte("src/views/customer/CheckoutView.tsx");
    expect(checkout).toMatch(
      /aria-label="Fechar resumo do pedido"[\s\S]{0,700}<ChevronUp /,
    );

    const produto = fonte("src/views/admin/AdminProductFormView.tsx");
    expect(produto).not.toMatch(/group-open:rotate-90/);
    expect(produto).toMatch(/group-open:rotate-180/);
    expect(produto).toMatch(
      /productId \? \(\s*<Check className="size-5" \/>\s*\) : \(\s*<Plus/,
    );

    const perfil = fonte("src/views/customer/ProfileView.tsx");
    expect(perfil).not.toMatch(/-rotate-90/);

    const privacidade = fonte(
      "src/components/account/PrivacidadeEMeusDados.tsx",
    );
    expect(privacidade).not.toMatch(/Minus/);

    const sanfona = fonte(
      "src/components/admin/settings/PrivacidadeDosClientesSection.tsx",
    );
    expect(sanfona).toMatch(/group-open:rotate-180/);
  });

  it("onde o pedido abre DENTRO do app não há ícone de 'abrir fora'", () => {
    for (const caminho of [
      "src/views/admin/AdminUserDetailView.tsx",
      "src/components/admin/devolucoes/DetalheDaDevolucao.tsx",
      "src/components/admin/financeiro/AbaPrevistos.tsx",
      "src/components/admin/orders/DevolucaoDoPedidoAdminCard.tsx",
    ]) {
      expect(fonte(caminho), caminho).not.toMatch(/ExternalLink|ArrowUpRight/);
    }
    expect(
      fonte("src/components/admin/financeiro/FolhasDeLancamento.tsx"),
    ).not.toMatch(/ExternalLink/);
  });
});
