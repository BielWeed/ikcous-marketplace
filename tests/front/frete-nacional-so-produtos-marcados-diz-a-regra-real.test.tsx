// @vitest-environment jsdom
//
// Rodada 5, achado 8: a opção "Só produtos marcados" do frete nacional dizia
// "só o que você marcar como frete grátis no cadastro do produto", o que lê
// como "só o item marcado viaja de graça". A regra real (edge
// `calculate-shipping`, `itemComFreteGratisMarcado` com `.some`, e a RPC do
// pedido, `v_has_free_shipping_item`) é outra: basta UM item marcado no
// carrinho para o frete do PEDIDO INTEIRO sair grátis. O texto da loja tem de
// dizer isso — a regra em si não mudou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EstrategiaNacionalBloco } from "@/components/admin/shipping/EstrategiaNacionalBloco";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function opcao(nome: string): HTMLElement {
  const botoes = Array.from(
    host.querySelectorAll<HTMLElement>('[role="radio"]'),
  );
  const achado = botoes.find((b) => b.textContent?.includes(nome));
  if (!achado) throw new Error(`opção '${nome}' não encontrada`);
  return achado;
}

describe("frete nacional — 'Só produtos marcados' diz a regra real", () => {
  beforeEach(() => {
    act(() =>
      raiz.render(
        <EstrategiaNacionalBloco
          estrategia="por_produto"
          minimo={0}
          tipoDesconto={null}
          valorDesconto={0}
          alcance="mais_barata"
          onEscolherEstrategia={vi.fn()}
          onMinimo={vi.fn()}
          onTipoDesconto={vi.fn()}
          onValorDesconto={vi.fn()}
          onAlcance={vi.fn()}
        />,
      ),
    );
  });

  it("avisa que um produto marcado no carrinho zera o frete do pedido todo", () => {
    const texto = opcao("Só produtos marcados").textContent ?? "";
    expect(texto).toMatch(/pelo menos um produto marcado/i);
    expect(texto).toMatch(/frete de todo o pedido/i);
    expect(texto).toMatch(/gr[áa]tis/i);
  });

  it("não sobrou a promessa antiga de 'só o que você marcar'", () => {
    expect(host.textContent ?? "").not.toMatch(/só o que você marcar/i);
  });

  it("controle: as outras quatro opções continuam com o texto de antes", () => {
    expect(opcao("Não dar frete grátis").textContent).toContain(
      "O cliente paga o preço da transportadora.",
    );
    expect(opcao("Grátis acima de um valor").textContent).toContain(
      "Pedidos a partir do valor não pagam o frete.",
    );
    expect(opcao("Sempre grátis").textContent).toContain(
      "Nenhum pedido paga o frete da transportadora.",
    );
    expect(opcao("Desconto no frete").textContent).toContain(
      "Uma porcentagem ou um valor a menos na opção mais barata.",
    );
  });
});
