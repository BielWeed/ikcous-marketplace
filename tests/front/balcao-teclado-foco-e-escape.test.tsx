// @vitest-environment jsdom
import {
  BuscaDeProduto,
  type ProdutoEncontradoNaBusca,
} from "@/components/admin/pdv/BuscaDeProduto";
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import {
  estadoInicialDaVenda,
  reducerDaVenda,
  type EstadoDaVenda,
} from "@/hooks/useVendaPresencial";
import { act, useReducer } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

const produto: ProdutoEncontradoNaBusca = {
  id: "p1",
  nome: "Caneca",
  preco_venda: 20,
  estoque: 4,
  imagem_url: null,
  imagem_urls: null,
  product_variants: [],
};
const variante = {
  id: "v1",
  name: "Cor",
  value: "Azul",
  price_override: null,
  stock_increment: 4,
  active: true,
  image_url: null,
};
function botao(texto: string, local: ParentNode = host): HTMLButtonElement {
  const encontrado = [...local.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  expect(encontrado).toBeTruthy();
  return encontrado!;
}
// jsdom não executa a ativação nativa de Enter em button: depois da tecla,
// emitimos o clique que o navegador produziria (sem handler de teste no app).
function enter(botao: HTMLButtonElement) {
  botao.focus();
  botao.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  botao.click();
}
it.each([false, true])(
  "adicionar por Enter devolve o foco à busca (variação: %s)",
  async (comVariacao) => {
    const despachar = vi.fn();
    await act(async () =>
      root.render(
        <BuscaDeProduto
          visivel
          despachar={despachar}
          buscarProdutos={async () => ({
            total: 1,
            produtos: [
              { ...produto, product_variants: comVariacao ? [variante] : [] },
            ],
          })}
        />,
      ),
    );
    const campo = host.querySelector("input")!;
    act(() => campo.focus());
    if (comVariacao) act(() => enter(botao("Caneca")));
    act(() => enter(botao(comVariacao ? "Cor Azul" : "Caneca")));
    expect(despachar).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(campo);
  },
);

const comItem: EstadoDaVenda = {
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
      imagem: "",
    },
  ],
};
function CupomComEstado({
  inicial,
  limpar,
}: { inicial: EstadoDaVenda; limpar: () => void }) {
  const [estado, despachar] = useReducer(reducerDaVenda, inicial);
  return (
    <>
      <input id="busca-manual-de-produto" aria-label="Buscar produto" />
      <CupomDaVenda
        estado={estado}
        despachar={despachar}
        subtotal={20}
        onNavigate={() => {}}
        limparCupom={limpar}
        feedback={null}
      />
    </>
  );
}
it.each(["variacao", "cancelamento"])(
  "Esc fecha só a camada de %s e preserva os itens",
  async (camada) => {
    const limpar = vi.fn();
    const inicial =
      camada === "variacao"
        ? {
            ...comItem,
            etapa: "escolha_de_variacao" as const,
            escolhaDeVariacao: {
              codigo: "123",
              produtoId: "p2",
              produtoNome: "Camiseta",
              opcoes: [
                {
                  variant_id: "v2",
                  nome: "Tamanho",
                  valor: "P",
                  preco: 30,
                  estoque: 3,
                  imagem: null,
                  codigo_barras: null,
                },
              ],
            },
          }
        : comItem;
    await act(async () =>
      root.render(<CupomComEstado inicial={inicial} limpar={limpar} />),
    );
    if (camada === "cancelamento") act(() => botao("Cancelar").click());
    const seletor =
      camada === "variacao"
        ? '[aria-label="Escolher variação"]'
        : '[aria-label="Cancelar venda"]';
    const folha = host.querySelector(seletor)!;
    expect(folha).not.toBeNull();
    const controle = folha.querySelector("button")!;
    expect(document.activeElement).toBe(controle);
    act(() => {
      controle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelector(seletor)).toBeNull();
    expect(
      host.querySelector('[aria-label="Itens da venda"]')?.textContent,
    ).toContain("Caneca");
    expect(limpar).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(host.querySelector("input"));
  },
);
