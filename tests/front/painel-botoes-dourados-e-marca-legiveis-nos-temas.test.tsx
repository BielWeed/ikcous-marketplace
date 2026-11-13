import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import { PerguntaDoRecebimento } from "@/components/admin/orders/ConfirmarRecebimento";
import { SeletorDeAtributo } from "@/components/admin/products/SeletorDeAtributo";
import type { Order } from "@/types";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/* eslint-disable security/detect-non-literal-fs-filename -- lê apenas fontes do repositório */
// @vitest-environment jsdom
//
// Temas Claro e Confortável do painel: o CSS do tema remapeia `.text-zinc-100` e
// `.text-white` (1 classe, e o arquivo carrega DEPOIS do Tailwind), então uma
// segunda `text-*` no mesmo elemento perde. Três pontos ficavam ilegíveis:
// o texto do botão dourado de pedidos, o texto do "Salvar nome" sobre o dourado
// da folha de categorias, e o check branco sobre a bolinha de cor escura.

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

const classes = (el: Element | null | undefined) =>
  (el?.getAttribute("class") ?? "").split(/\s+/);
const botaoCom = (texto: string) =>
  [...hospedeiro.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(texto),
  );

const pedido: Order = {
  id: "pedido-abc123",
  customer: { name: "Maria", whatsapp: "11999999999" },
  items: [
    {
      productId: "p1",
      name: "Caneca",
      quantity: 2,
      price: 10,
      image: "",
    },
  ],
  subtotal: 20,
  total: 20,
  shipping: 0,
  discount: 0,
  status: "pending",
  paymentMethod: "online",
  paymentStatus: "pago",
  createdAt: "2026-10-17T12:00:00Z",
  updatedAt: "2026-10-17T12:00:00Z",
  cancelledAfterShipping: false,
};

describe("botão dourado de pedidos: o texto escuro não divide a cor com o remapeado", () => {
  it("'Avançar' do cartão leva o texto escuro e NÃO herda text-zinc-100", async () => {
    await act(async () => {
      raiz.render(
        <AdminOrderCard
          order={pedido}
          viewMode="compact"
          onSelect={() => {}}
          onWhatsApp={() => {}}
          onRegistrarPagamento={async () => {}}
          registrandoPagamento={false}
          onStatusChange={async () => {}}
          onReceberAntesDeAvancar={async () => {}}
          onAnularVenda={async () => {}}
          isOffline={false}
          destaquePrimario
        />,
      );
    });
    const avancar = botaoCom("Avançar → Em Separação");
    expect(avancar, "botão principal do cartão").toBeTruthy();
    expect(classes(avancar)).toContain("text-[#211A05]");
    expect(classes(avancar)).not.toContain("text-zinc-100");
  });

  it("'Recebi' do recebimento leva o texto escuro e o 'Ainda não' continua com text-zinc-100", async () => {
    await act(async () => {
      raiz.render(
        <PerguntaDoRecebimento
          total={20}
          aoCancelar={() => {}}
          aoConfirmar={() => {}}
        />,
      );
    });
    const recebi = botaoCom("Recebi");
    expect(classes(recebi)).toContain("text-[#211A05]");
    expect(classes(recebi)).not.toContain("text-zinc-100");
    expect(classes(botaoCom("Ainda não"))).toContain("text-zinc-100");
  });
});

describe("folha de categorias: o dourado do submit traz o próprio texto escuro", () => {
  it("a regra do submit da tela de produtos fixa a cor do texto", () => {
    const css = readFileSync(
      join(
        __dirname,
        "../../src/components/admin/products/catalogo-produtos.css",
      ),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const regra = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
      ([, cabecalho]) =>
        cabecalho.replace(/\s/g, "") ===
        'body:has(.produtos-tela[data-categorias])[role="dialog"]button[type="submit"]',
    );
    expect(regra, "regra do submit dourado").toBeDefined();
    // O botão "Salvar nome" usa text-background, que no Claro é quase branco.
    expect(regra?.[2]).toMatch(/linear-gradient\(#f8d658/);
    expect(regra?.[2]).toMatch(/(?<![-\w])color:\s*#211a07/i);
  });
});

describe("bolinha de cor escura: o check branco escapa da troca de tema", () => {
  function Escolha({ valor }: { valor: string }) {
    const [nome, setNome] = useState("Cor");
    const [v, setV] = useState(valor);
    return (
      <SeletorDeAtributo
        modo="unico"
        numero={1}
        idDoNome="variant-name"
        idDoValor="variant-value"
        nome={nome}
        onNome={setNome}
        valor={v}
        onValor={setV}
      />
    );
  }

  it("check sobre cor escura fica branco e escapa do remapeado", async () => {
    await act(async () => {
      raiz.render(<Escolha valor="Preto" />);
    });
    const check = hospedeiro.querySelector('svg[data-marca="selecionado"]');
    expect(classes(check)).toContain("text-white");
    expect(check?.hasAttribute("data-tema-fixo")).toBe(true);
  });

  it("check sobre cor clara continua escuro", async () => {
    await act(async () => {
      raiz.render(<Escolha valor="Branco" />);
    });
    const check = hospedeiro.querySelector('svg[data-marca="selecionado"]');
    expect(classes(check)).toContain("text-zinc-900");
    expect(classes(check)).not.toContain("text-white");
  });
});
