// @vitest-environment jsdom
import { BuscaDeProduto } from "@/components/admin/pdv/BuscaDeProduto";
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import { estadoInicialDaVenda } from "@/hooks/useVendaPresencial";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("BuscaDeProduto troca imagem que falha pelo ícone original", async () => {
  const hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  const raiz = createRoot(hospedeiro);
  try {
    await act(async () =>
      raiz.render(
        <BuscaDeProduto
          visivel
          despachar={vi.fn()}
          buscarProdutos={async () => ({
            produtos: [
              {
                id: "vestido",
                nome: "Vestido",
                preco_venda: 100,
                estoque: 5,
                imagem_url: "https://loja.example/vestido.jpg",
                imagem_urls: [],
                product_variants: [],
              },
            ],
            total: 1,
          })}
        />,
      ),
    );
    const linha = hospedeiro.querySelector(".pdv-result")!;
    const foto = linha.querySelector("img")!;
    expect(foto).not.toBeNull();
    await act(async () => foto.dispatchEvent(new Event("error")));
    expect(linha.querySelector("img")).toBeNull();
    expect(linha.querySelector("svg.lucide-package-plus")).not.toBeNull();
    expect(linha.textContent).toContain("Vestido");
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
  }
});

it("CupomDaVenda troca imagem que falha pelo ícone original", async () => {
  const hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  const raiz = createRoot(hospedeiro);
  const estado = {
    ...estadoInicialDaVenda(() => "teste"),
    itens: [
      {
        chave: "vestido",
        productId: "vestido",
        variantId: null,
        nome: "Vestido",
        variacao: null,
        imagem: "https://loja.example/vestido.jpg",
        preco: 100,
        quantidade: 1,
        estoque: 5,
      },
    ],
  };
  try {
    await act(async () =>
      raiz.render(
        <CupomDaVenda
          estado={estado}
          despachar={vi.fn()}
          subtotal={100}
          onNavigate={vi.fn()}
          feedback={null}
        />,
      ),
    );
    const linha = hospedeiro.querySelector(".pdv-item")!;
    const foto = linha.querySelector("img")!;
    expect(foto).not.toBeNull();
    await act(async () => foto.dispatchEvent(new Event("error")));
    expect(linha.querySelector("img")).toBeNull();
    expect(linha.querySelector("svg.lucide-package-plus")).not.toBeNull();
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
  }
});
