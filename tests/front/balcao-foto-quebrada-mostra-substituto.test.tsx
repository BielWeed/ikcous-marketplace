// @vitest-environment jsdom
import { BuscaDeProduto } from "@/components/admin/pdv/BuscaDeProduto";
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import { estadoInicialDaVenda } from "@/hooks/useVendaPresencial";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function exigirSubstituto() {
  const img = host.querySelector("img")!;
  expect(img).not.toBeNull();
  expect(img.getAttribute("src")).toBe("/apagada.jpg");
  act(() => img.dispatchEvent(new Event("error")));
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".lucide-package-plus")).not.toBeNull();
  expect(host.textContent).toContain("Caneca");
}

it("a busca do balcão substitui a foto que não abre", async () => {
  await act(async () =>
    root.render(
      <BuscaDeProduto
        visivel
        despachar={() => {}}
        buscarProdutos={async () => ({
          total: 1,
          produtos: [
            {
              id: "p1",
              nome: "Caneca",
              preco_venda: 20,
              estoque: 4,
              imagem_url: "/apagada.jpg",
              imagem_urls: null,
              product_variants: [],
            },
          ],
        })}
      />,
    ),
  );
  exigirSubstituto();
});

it("o cupom da venda substitui a foto que não abre", () => {
  act(() =>
    root.render(
      <CupomDaVenda
        feedback={null}
        despachar={() => {}}
        subtotal={20}
        onNavigate={() => {}}
        estado={{
          ...estadoInicialDaVenda(() => "teste"),
          itens: [
            {
              chave: "p1::",
              productId: "p1",
              variantId: null,
              nome: "Caneca",
              variacao: null,
              preco: 20,
              quantidade: 1,
              estoque: 4,
              imagem: "/apagada.jpg",
            },
          ],
        }}
      />,
    ),
  );
  exigirSubstituto();
});
