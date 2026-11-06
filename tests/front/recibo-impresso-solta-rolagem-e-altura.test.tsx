// @vitest-environment jsdom
//
// Recibo impresso (ficha do pedido e Vender/balcão): o papel ficava DENTRO do
// painel, em `position: absolute; top: 0`. O painel rola por dentro (html, body,
// #root e o shell têm altura 100% e `overflow: hidden`; o balcão ainda tem o
// `.pdv-viewport` que rola sozinho). Na impressão isso cortava o recibo: com a
// tela rolada o topo sumia; com muitos itens, o TOTAL ficava de fora. Soltar a
// altura de tudo no painel (`#root *`) resolvia o corte, mas o painel escondido
// só com `visibility: hidden` seguia ocupando espaço e saíam folhas em branco.
// Desenho certo: o papel mora FORA do #root (portal no body); na impressão o
// #root some de verdade (`display: none`) e html/body soltam a altura.
//
// O jsdom não calcula impressão: o teste confere a estrutura (o papel fora do
// #root) e o CSS que o papel entrega. A contagem de páginas foi medida no Chrome.
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(): Order {
  return {
    id: "pedido-1234567890",
    customer: { name: "Maria Teste", whatsapp: "11999999999" },
    items: Array.from({ length: 90 }, (_, i) => ({
      productId: `prod-${i}`,
      name: `Produto ${i}`,
      price: 10,
      quantity: 1,
      image: "",
    })),
    subtotal: 900,
    shipping: 0,
    discount: 0,
    total: 900,
    paymentMethod: "pix",
    status: "delivered",
    createdAt: new Date("2026-10-20T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-10-20T10:00:00Z").toISOString(),
    cancelledAfterShipping: false,
    canal: "presencial",
  };
}

/** Todas as regras do `@media print` do papel: `[seletores, declarações]`. */
function regrasDeImpressao(css: string): Array<[string, string]> {
  const inicio = css.indexOf("@media print");
  expect(inicio).toBeGreaterThanOrEqual(0);
  const abre = css.indexOf("{", inicio);
  let fundo = 1;
  let i = abre + 1;
  while (i < css.length && fundo > 0) {
    if (css.charAt(i) === "{") fundo += 1;
    if (css.charAt(i) === "}") fundo -= 1;
    i += 1;
  }
  const corpo = css.slice(abre + 1, i - 1).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...corpo.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (m) => [m[1].replace(/\s+/g, " ").trim(), m[2]] as [string, string],
  );
}

describe("recibo impresso — fora do painel, que some na impressão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let painel: HTMLDivElement;

  beforeEach(() => {
    // Imita o index.html: o app inteiro vive em #root; o papel NÃO pode ficar lá.
    painel = document.createElement("div");
    painel.id = "root";
    document.body.appendChild(painel);
    hospedeiro = document.createElement("div");
    painel.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    painel.remove();
  });

  async function montar(): Promise<string> {
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido()} storeName="Loja Teste" />);
    });
    return document.querySelector("style")?.textContent ?? "";
  }

  it("o papel é montado no body, fora do #root (o painel que some na impressão não o leva junto)", async () => {
    await montar();
    const papel = document.querySelector("[data-tema-fixo]");
    expect(papel).not.toBeNull();
    expect(painel.contains(papel)).toBe(false);
    expect(papel?.parentElement).toBe(document.body);
    expect(hospedeiro.querySelector("[data-tema-fixo]")).toBeNull();
  });

  it("ao desmontar, o papel sai do body (nada de recibo fantasma)", async () => {
    await montar();
    act(() => {
      raiz.unmount();
    });
    expect(document.querySelector("[data-tema-fixo]")).toBeNull();
    raiz = createRoot(hospedeiro);
  });

  it("na impressão: #root oculto de verdade, html e body com altura e rolagem soltas", async () => {
    const regras = regrasDeImpressao(await montar());
    const painelOculto = regras.find(([s]) => s === "#root");
    expect(painelOculto?.[1]).toMatch(/display:\s*none\s*!important/);
    const raizes = regras.find(([s]) => s === "html, body");
    expect(raizes?.[1]).toMatch(/height:\s*auto\s*!important/);
    expect(raizes?.[1]).toMatch(/overflow:\s*visible\s*!important/);
  });

  it("sem a regra que força altura em tudo dentro do painel (ela deixava folhas em branco)", async () => {
    const css = await montar();
    const bloco = regrasDeImpressao(css);
    expect(bloco.some(([s]) => s.includes("#root *"))).toBe(false);
  });

  it("o papel é estático na impressão (flui e pagina); o resto da página segue escondido", async () => {
    const regras = regrasDeImpressao(await montar());
    const escondeTudo = regras.find(([s]) => s === "body *");
    expect(escondeTudo?.[1]).toMatch(/visibility:\s*hidden/);
    const papel = regras.find(([s]) => s === ".print\\:block");
    expect(papel?.[1]).toMatch(/position:\s*static/);
    expect(papel?.[1]).not.toMatch(/absolute|fixed/);
    expect(papel?.[1]).toMatch(/display:\s*block\s*!important/);
  });

  it("o recibo com 90 itens traz todos os itens e o TOTAL no papel", async () => {
    await montar();
    const papel = document.querySelector("[data-tema-fixo]")!;
    expect(papel.textContent).toContain("Produto 0");
    expect(papel.textContent).toContain("Produto 89");
    expect(papel.textContent).toContain("TOTAL");
  });
});
