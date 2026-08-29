// @vitest-environment jsdom
//
// Prova a garantia que o item 3 inteiro existe para dar: depois da recusa, a
// pessoa VÊ UM BOTÃO. O toast antigo sumia sozinho e não levava a lugar nenhum.
//
// O teste exercita o componente puro, não a CheckoutView — ela arrasta useAuth,
// useOrders, useCoupons, confetti e Supabase, e nada disso é o que esta peça faz.
import { SaidaDaRecusa } from "@/components/ui/custom/SaidaDaRecusa";
import type { AcaoDeRecusa, RecusaDoPedido } from "@/lib/recusaDoPedido";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// outros 201 arquivos de `tests/front/` que montam com `createRoot`.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (
  recusa: RecusaDoPedido,
  onAgir: (a: AcaoDeRecusa) => void = () => {},
) => {
  act(() => {
    root.render(
      <SaidaDaRecusa recusa={recusa} onAgir={onAgir} onFechar={() => {}} />,
    );
  });
};

// As dez ações são o contrato de `AcaoDeRecusa`. A lista é escrita à mão de
// propósito: derivá-la do próprio componente faria o teste concordar consigo
// mesmo, e um caso esquecido lá passaria a ser um caso esquecido aqui também.
const TODAS_AS_ACOES: AcaoDeRecusa[] = [
  "reconferir_carrinho",
  "recotar_frete",
  "ajustar_estoque",
  "remover_item",
  "escolher_variacao",
  "trocar_endereco",
  "trocar_entrega",
  "remover_cupom",
  "tentar_de_novo",
  "conferir_antes",
];

describe("SaidaDaRecusa", () => {
  it("mostra a frase que o banco escreveu, sem reescrever", () => {
    render({
      acao: "reconferir_carrinho",
      mensagem:
        "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
    });
    expect(container.textContent).toContain("Os valores do pedido mudaram");
  });

  it("TODA ação de recusa tem um botão — nenhuma fica sem saída", () => {
    for (const acao of TODAS_AS_ACOES) {
      render({ acao, mensagem: "qualquer" });
      const botoes = container.querySelectorAll("button[data-acao]");
      expect(
        botoes.length,
        `a ação ${acao} ficou SEM botão — isso é o beco de volta`,
      ).toBeGreaterThan(0);
    }
  });

  it("o botão carrega a PRÓPRIA ação, não a de outra recusa", () => {
    // Controle do teste acima: contar botões não prova que o botão é o certo.
    for (const acao of TODAS_AS_ACOES) {
      render({ acao, mensagem: "qualquer" });
      const botao = container.querySelector("button[data-acao]");
      expect(botao?.getAttribute("data-acao"), `ação ${acao}`).toBe(acao);
    }
  });

  it("clicar no botão devolve a ação ao chamador", () => {
    const recebidas: AcaoDeRecusa[] = [];
    render(
      { acao: "recotar_frete", mensagem: "A cotação de frete expirou." },
      (a) => recebidas.push(a),
    );
    const botao = container.querySelector(
      "button[data-acao]",
    ) as HTMLButtonElement;
    act(() => botao.click());
    expect(recebidas).toEqual(["recotar_frete"]);
  });

  it("estoque insuficiente diz quanto ainda há", () => {
    // 🔴 A mensagem NÃO traz o número de propósito. A primeira versão deste
    // teste usava a frase completa do banco ("...Caneca (Disponível: 2...)"),
    // que já contém "Caneca" e "2" — então ele passava pela própria `mensagem`
    // e sobrevivia a apagar o detalhe do estoque inteiro. Prova de mutação de
    // 29/08/2026: a sabotagem "o detalhe do estoque some" SOBREVIVIA.
    // Com a frase curta, "2" só aparece na tela se o detalhe for renderizado.
    render({
      acao: "ajustar_estoque",
      mensagem: "Estoque insuficiente para o produto solicitado.",
      produto: "Caneca",
      disponivel: 2,
    });
    expect(container.textContent).toContain("Caneca");
    expect(container.textContent).toContain("2");
  });

  it("sem `disponivel`, o painel NÃO inventa quantidade", () => {
    // Controle negativo do caso acima: com o campo ausente, escrever
    // "ainda há undefined" seria pior que não escrever nada.
    render({
      acao: "ajustar_estoque",
      mensagem: "Estoque insuficiente para o produto solicitado.",
      produto: "Caneca",
    });
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("Ainda há");
  });

  it("conferir_antes NÃO oferece 'tentar de novo' — é assim que se duplica pedido", () => {
    render({ acao: "conferir_antes", mensagem: "Não conseguimos confirmar." });
    const rotulos = Array.from(container.querySelectorAll("button")).map((b) =>
      (b.textContent ?? "").toLowerCase(),
    );
    expect(rotulos.some((r) => r.includes("tentar de novo"))).toBe(false);
  });

  it("controle positivo do caso acima: tentar_de_novo OFERECE o botão de repetir", () => {
    // Sem este controle, o teste anterior passaria mesmo se o componente não
    // renderizasse botão nenhum em situação alguma.
    render({
      acao: "tentar_de_novo",
      mensagem: "Tente novamente em instantes.",
    });
    const rotulos = Array.from(container.querySelectorAll("button")).map((b) =>
      (b.textContent ?? "").toLowerCase(),
    );
    expect(rotulos.some((r) => r.includes("tentar de novo"))).toBe(true);
  });
});
