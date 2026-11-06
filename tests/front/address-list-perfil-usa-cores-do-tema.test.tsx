// @vitest-environment jsdom
//
// Achado 8 (R21): o cartão expandido de endereço do Perfil usava cores fixas
// de tema claro (fundo bg-zinc-50/50, textos zinc-600/900). Numa loja com
// tema escuro ou vidro o fundo vira um cinza-médio e o texto escuro quase
// some. O Perfil (sem `selectable`) passa a usar os tokens do tema. O modo
// `selectable` (checkout e carrinho) é congelado byte a byte em
// address-list-checkout-e-carrinho-nao-mudam.test.tsx e não entra aqui.
import { AddressList } from "@/components/ui/custom/AddressList";
import type { Address } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const CASA: Address = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Maria Teste",
  cep: "38400-000",
  street: "Rua Teste",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Cidade Teste",
  state: "MG",
  reference: null,
  is_default: true,
};

// Cor fixa de tema claro: fundo branco/zinc, texto ou borda zinc (com ou sem
// prefixo hover: e sem a opacidade /NN).
const ZINC = /^(bg|text|border)-zinc-[0-9]{2,3}$/;
const ehCorFixa = (classe: string) => {
  const nua = classe.replace("hover:", "").split("/")[0];
  return nua === "bg-white" || ZINC.test(nua);
};
const temCorFixa = (classe: string) => classe.split(/\s+/).some(ehCorFixa);

describe("AddressList do Perfil — cartão expandido usa as cores do tema", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  it("nenhum elemento do cartão expandido (sem selectable) leva cor fixa de tema claro", () => {
    act(() =>
      raiz.render(
        <AddressList
          addresses={[CASA]}
          onEdit={() => {}}
          onDelete={() => {}}
        />,
      ),
    );
    const comCorFixa = [...hospedeiro.querySelectorAll("*")]
      .map((el) => el.getAttribute("class") ?? "")
      .filter(temCorFixa);
    expect(comCorFixa).toEqual([]);
  });

  it("o texto do endereço e o fundo do cartão usam os tokens do tema", () => {
    act(() =>
      raiz.render(<AddressList addresses={[CASA]} onEdit={() => {}} />),
    );
    const cartao = hospedeiro.querySelector(".rounded-2xl");
    expect(cartao?.className).toContain("bg-muted/50");
    const nome = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent === "Casa",
    );
    expect(nome?.className).toContain("text-foreground");
    const cep = [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("CEP:"),
    );
    expect(cep?.className).toContain("text-foreground/70");
  });
});
