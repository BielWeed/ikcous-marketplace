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

it("reserva a barra medida e limita a rolagem à lista, sem aumentar a página", () => {
  const css = readFileSync("src/components/admin/pdv/pdv.css", "utf8");
  expect(css).toMatch(/\.pdv-viewport\s*\{[^}]*height: 100%/);
  expect(css).toMatch(/\.pdv-viewport\s*\{[^}]*overflow: hidden/);
  expect(css).toMatch(/\.pdv-viewport\s*\{[^}]*--admin-tab-pb/);
  expect(css).toMatch(
    /\.pdv-cupom\[data-resumo="false"\] > ul\s*\{[^}]*min-height: 0/,
  );
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
