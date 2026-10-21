import { readFileSync } from "node:fs";
// @vitest-environment jsdom
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import {
  estadoInicialDaVenda,
  reducerDaVenda,
} from "@/hooks/useVendaPresencial";
import { act, useReducer } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let raiz: Root;
const item = {
  chave: "p::",
  productId: "p",
  variantId: null,
  nome: "Caderno",
  variacao: null,
  imagem: "",
  preco: 10,
  quantidade: 1,
  estoque: 3,
};
const inicial = { ...estadoInicialDaVenda(() => "teste"), itens: [item] };

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});
function botao(texto: string) {
  return [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  )!;
}

it("reserva a barra medida sem impedir a rolagem do conteúdo em telas baixas", () => {
  const css = readFileSync("src/components/admin/pdv/pdv.css", "utf8");
  expect(css).toMatch(/\.pdv-viewport\s*\{[^}]*height: 100%/);
  expect(css).toMatch(/\.pdv-viewport\s*\{[^}]*overflow: hidden/);
  expect(css).toMatch(/\.pdv-viewport\s*\{[^}]*--admin-tab-pb/);
  expect(css).toMatch(
    /\.pdv-cupom\[data-resumo="false"\] > ul\s*\{[^}]*min-height: 0/,
  );
  for (const classe of ["pdv-checkout-body", "pdv-variation-options"]) {
    const bloco = css.match(new RegExp(`\\.${classe}\\s*\\{([^}]+)\\}`))?.[1];
    expect(bloco, classe).toMatch(/min-height:\s*0/);
    expect(bloco, classe).toMatch(/overflow-y:\s*(auto|scroll)/);
    expect(bloco, classe).toMatch(/overscroll-behavior:\s*contain/);
  }
});

it("fechamento e variações montam os corpos roláveis sem levar a barra de ações junto", async () => {
  await act(async () =>
    raiz.render(
      <FechamentoDaVenda
        estado={{ ...inicial, erro: "Falha de rede", pagamento: "pix" }}
        despachar={vi.fn()}
        aoRegistrarVenda={vi.fn()}
        limparCupom={vi.fn()}
      />,
    ),
  );
  const corpo = host.querySelector(".pdv-checkout-body")!;
  expect(corpo).not.toBeNull();
  expect(corpo.querySelector(".pdv-layer-heading")).not.toBeNull();
  expect(corpo.querySelector(".pdv-cupom")?.textContent).toContain(
    "Venda atual",
  );
  expect(corpo.querySelector(".pdv-cupom")?.textContent).toContain("R$ 10,00");
  expect(corpo.querySelector(".pdv-payment-grid")).not.toBeNull();
  expect(corpo.querySelector("#conferi-o-pagamento")).not.toBeNull();
  expect(corpo.querySelector('[role="alert"]')?.textContent).toContain(
    "Falha de rede",
  );
  expect(corpo.querySelector(".pdv-sale-action")).toBeNull();
  corpo.scrollTop = 120;
  await act(async () =>
    raiz.render(
      <FechamentoDaVenda
        estado={{ ...inicial, erro: "Nova falha", pagamento: "pix" }}
        despachar={vi.fn()}
        aoRegistrarVenda={vi.fn()}
        limparCupom={vi.fn()}
      />,
    ),
  );
  expect(corpo.scrollTop).toBe(0);
  expect(corpo.querySelector('[role="alert"]')).toBe(corpo.firstElementChild);
  await act(async () =>
    raiz.render(
      <CupomDaVenda
        estado={{
          ...inicial,
          etapa: "escolha_de_variacao",
          escolhaDeVariacao: {
            codigo: "123",
            produtoId: "p",
            produtoNome: "Caderno",
            opcoes: [
              {
                variant_id: "azul",
                nome: "Cor",
                valor: "Azul",
                preco: 10,
                estoque: 2,
                imagem: null,
                codigo_barras: null,
              },
            ],
          },
        }}
        subtotal={10}
        despachar={vi.fn()}
        onNavigate={vi.fn()}
        feedback={null}
      />,
    ),
  );
  const variacoes = host.querySelector(".pdv-variation-options")!;
  expect(variacoes).not.toBeNull();
  expect(variacoes.textContent).toContain("Azul");
  expect(
    host.querySelector(".pdv-variation-heading .pdv-variation-cancel"),
  ).not.toBeNull();
  expect(variacoes.querySelector(".pdv-variation-cancel")).toBeNull();
  expect(variacoes.querySelector(".pdv-sale-action")).toBeNull();
});

it("o resumo aparece uma só vez no fechamento e Cancelar fica fora da rolagem", async () => {
  const estado = {
    ...inicial,
    etapa: "fechamento" as const,
    cliente: {
      tipo: "avulso" as const,
      nome: "Pessoa de teste",
      whatsapp: "11999990000",
    },
  };
  await act(async () =>
    raiz.render(
      <>
        <CupomDaVenda
          estado={estado}
          subtotal={10}
          despachar={vi.fn()}
          onNavigate={vi.fn()}
          limparCupom={vi.fn()}
          feedback={null}
        />
        <FechamentoDaVenda
          estado={estado}
          despachar={vi.fn()}
          aoRegistrarVenda={vi.fn()}
          limparCupom={vi.fn()}
        />
      </>,
    ),
  );
  expect(host.querySelectorAll(".pdv-cupom")).toHaveLength(1);
  expect(
    host.querySelector(".pdv-checkout-body .pdv-cupom")?.textContent,
  ).toContain("Pessoa de teste");
  expect(host.querySelector(".pdv-checkout-body .pdv-cancel")).toBeNull();
  expect(host.querySelector(".pdv-cancel")).not.toBeNull();
});

it("a escolha de variação mantém o título principal acessível", () => {
  const view = readFileSync("src/views/admin/AdminPdvView.tsx", "utf8");
  const css = readFileSync("src/components/admin/pdv/pdv.css", "utf8");
  expect(view).toContain('estado.etapa === "cupom" ? "" : "sr-only"');
  expect(css).not.toMatch(
    /\.pdv\[data-etapa="escolha_de_variacao"\] \.pdv-page-heading[^}]*display:\s*none/,
  );
});

it("controles compactos mantêm alvos de toque de pelo menos 40px", () => {
  const css = readFileSync("src/components/admin/pdv/pdv.css", "utf8");
  for (const seletor of [
    ".pdv-touch",
    ".pdv-modes button",
    ".pdv-payment",
    ".pdv .pdv-cancel[data-slot]",
    ".pdv-conference label",
  ]) {
    const blocos = css
      .split("}")
      .filter(
        (bloco) =>
          bloco.trim().endsWith("{") === false &&
          bloco.includes(`${seletor} {`),
      );
    expect(blocos.length).toBeGreaterThan(0);
    for (const bloco of blocos) {
      const altura = /min-height:\s*(\d+)px/.exec(bloco)?.[1];
      if (altura) expect(Number(altura), seletor).toBeGreaterThanOrEqual(40);
    }
  }
  expect(css).toMatch(/\.pdv-touch\s*\{[^}]*width:\s*40px/);
});

it("fechar e registrar usam o botão verde, nunca o principal dourado da barra", async () => {
  await act(async () =>
    raiz.render(
      <CupomDaVenda
        estado={inicial}
        subtotal={10}
        despachar={vi.fn()}
        onNavigate={vi.fn()}
        feedback={null}
      />,
    ),
  );
  expect(botao("Fechar venda").classList.contains("pdv-sale-action")).toBe(
    true,
  );
  expect(botao("Fechar venda").className).not.toContain(
    "admin-barra-principal",
  );
  await act(async () =>
    raiz.render(
      <FechamentoDaVenda
        estado={{ ...inicial, pagamento: "cash" }}
        despachar={vi.fn()}
        aoRegistrarVenda={vi.fn()}
        limparCupom={vi.fn()}
      />,
    ),
  );
  expect(botao("Registrar venda").classList.contains("pdv-sale-action")).toBe(
    true,
  );
  expect(botao("Registrar venda").disabled).toBe(false);
  expect(botao("Registrar venda").className).not.toContain(
    "admin-barra-principal",
  );
});

it("na quantidade um o stepper oferece lixeira e remove de verdade; acima de um diminui", async () => {
  function Cupom({ quantidade }: { quantidade: number }) {
    const [estado, despachar] = useReducer(reducerDaVenda, {
      ...inicial,
      itens: [{ ...item, quantidade }],
    });
    return (
      <CupomDaVenda
        estado={estado}
        subtotal={10 * (estado.itens[0]?.quantidade ?? 0)}
        despachar={despachar}
        onNavigate={vi.fn()}
        feedback={null}
      />
    );
  }
  await act(async () => raiz.render(<Cupom key="duas" quantidade={2} />));
  const menos = host.querySelector<HTMLButtonElement>(
    '[aria-label="Diminuir quantidade de Caderno"]',
  )!;
  expect(menos.querySelector(".lucide-minus")).not.toBeNull();
  await act(async () => menos.click());
  const lixeira = host.querySelector<HTMLButtonElement>(
    '.pdv-quantity [aria-label="Remover Caderno da venda"]',
  )!;
  expect(lixeira).not.toBeNull();
  expect(lixeira.querySelector(".lucide-trash-2")).not.toBeNull();
  await act(async () => lixeira.click());
  expect(host.querySelectorAll(".pdv-item")).toHaveLength(0);
  expect(botao("Fechar venda").disabled).toBe(true);
});

it("cancelar é pílula no topo e continua pedindo confirmação antes de limpar", async () => {
  const limpar = vi.fn();
  await act(async () =>
    raiz.render(
      <CupomDaVenda
        estado={inicial}
        subtotal={10}
        despachar={vi.fn()}
        onNavigate={vi.fn()}
        limparCupom={limpar}
        feedback={null}
      />,
    ),
  );
  const cancelar = host.querySelector<HTMLButtonElement>(".pdv-cancel")!;
  expect(cancelar).not.toBeNull();
  expect(cancelar.textContent).toContain("Cancelar");
  expect(
    cancelar.compareDocumentPosition(host.querySelector(".pdv-cupom")!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await act(async () => cancelar.click());
  expect(host.textContent).toContain("Descartar esta venda?");
  expect(limpar).not.toHaveBeenCalled();
  await act(async () => botao("Sim, cancelar venda").click());
  expect(limpar).toHaveBeenCalledTimes(1);
});
