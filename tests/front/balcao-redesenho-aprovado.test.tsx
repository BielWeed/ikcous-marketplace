// @vitest-environment jsdom
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import { estadoInicialDaVenda } from "@/hooks/useVendaPresencial";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
const item = {
  chave: "produto::",
  productId: "produto",
  variantId: null,
  nome: "Kit organizador de mesa com divisórias e suporte para celular",
  variacao: "Areia",
  imagem: "",
  preco: 99.9,
  quantidade: 12,
  estoque: 12,
};
const estado = { ...estadoInicialDaVenda(() => "chave"), itens: [item] };

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

it("cupom vazio explica o bloqueio e mantém a busca e a identificação disponíveis", async () => {
  await act(async () =>
    raiz.render(
      <CupomDaVenda
        estado={estadoInicialDaVenda(() => "vazia")}
        subtotal={0}
        despachar={vi.fn()}
        buscarProdutos={vi.fn()}
        onNavigate={vi.fn()}
        feedback={null}
      />,
    ),
  );
  expect(host.textContent).toContain("Seu cupom está vazio.");
  expect(host.textContent).toContain(
    "Indisponível: adicione pelo menos um item.",
  );
  expect(botao("Fechar venda").disabled).toBe(true);
  expect(botao("Cliente (opcional)").disabled).toBe(false);
  expect(
    host.querySelector('label[for="busca-manual-de-produto"]'),
  ).not.toBeNull();
});

it("cupom mantém nomes completos, controles nomeados e o valor junto à ação de fechar", async () => {
  const despachar = vi.fn();
  await act(async () =>
    raiz.render(
      <CupomDaVenda
        estado={estado}
        subtotal={1198.8}
        despachar={despachar}
        buscarProdutos={vi.fn()}
        onNavigate={vi.fn()}
        limparCupom={vi.fn()}
        feedback={null}
      />,
    ),
  );
  const linha = host.querySelector("li")!;
  expect(linha.textContent).toContain(item.nome);
  expect(linha.querySelector(".truncate")).toBeNull();
  const aumentar = linha.querySelector<HTMLButtonElement>(
    `[aria-label="Aumentar quantidade de ${item.nome}"]`,
  )!;
  expect(aumentar.disabled).toBe(true);
  expect(linha.textContent).toContain("Limite do estoque");
  expect(botao("Fechar venda").textContent).toContain("R$ 1.198,80");
  expect(
    botao("Cliente (opcional)").compareDocumentPosition(
      botao("Cancelar venda"),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    botao("Cancelar venda").compareDocumentPosition(
      host.querySelector("#busca-manual-de-produto")!,
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await act(async () =>
    linha
      .querySelector<HTMLButtonElement>(
        `[aria-label="Diminuir quantidade de ${item.nome}"]`,
      )!
      .click(),
  );
  expect(despachar).toHaveBeenCalledWith({
    tipo: "quantidade_alterada",
    chave: "produto::",
    delta: -1,
  });
});

it("fechamento apresenta desconto antes do pagamento e conserva a conferência obrigatória", async () => {
  const registrar = vi.fn();
  await act(async () =>
    raiz.render(
      <FechamentoDaVenda
        estado={{
          ...estado,
          pagamento: "pix",
          desconto: 5,
          motivoDoDesconto: "Ajuste de vitrine",
        }}
        despachar={vi.fn()}
        aoRegistrarVenda={registrar}
        limparCupom={vi.fn()}
      />,
    ),
  );
  const desconto = host.querySelector("#desconto-da-venda")!;
  const pix = botao("PIX na hora");
  expect(
    desconto.compareDocumentPosition(pix) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(pix.getAttribute("aria-pressed")).toBe("true");
  expect(botao("Registrar venda").disabled).toBe(true);
  expect(host.querySelector('label[for="conferi-o-pagamento"]')).not.toBeNull();
  expect(host.textContent).toContain("Total com desconto");
  // O valor cobrado é o total COM desconto, não o subtotal: 12 × 99,90 − 5.
  expect(host.querySelector(".pdv-footer strong")!.textContent).toBe(
    "R$ 1.193,80",
  );
  await act(async () => botao("Registrar venda").click());
  expect(registrar).not.toHaveBeenCalled();
});

it("identificação conserva o subtotal e a ação existente de fechar a venda", async () => {
  const despachar = vi.fn();
  await act(async () =>
    raiz.render(
      <CupomDaVenda
        estado={{ ...estado, etapa: "cliente" }}
        subtotal={1198.8}
        despachar={despachar}
        buscarProdutos={vi.fn()}
        onNavigate={vi.fn()}
        feedback={null}
      />,
    ),
  );
  const resumo = host.querySelector('[aria-label="Fechamento do cupom"]')!;
  expect(resumo.textContent).toContain("R$ 1.198,80");
  const fechar = resumo.querySelector("button")!;
  expect(fechar.disabled).toBe(false);
  expect(fechar.textContent).toContain("Fechar venda");
  await act(async () => fechar.click());
  expect(despachar).toHaveBeenCalledWith({
    tipo: "etapa_pedida",
    etapa: "fechamento",
  });
});

it("recibo explica WhatsApp inválido e oferece impressão antes da anulação e da nova venda", async () => {
  await act(async () =>
    raiz.render(
      <ReciboDaVenda
        recibo={{
          orderId: "p1",
          numero: "ABC123",
          criadoEm: "2026-10-17T15:00:00Z",
          itens: [item],
          subtotal: 1198.8,
          desconto: 0,
          total: 1198.8,
          pagamento: "cash",
          cliente: { tipo: "avulso", nome: "Lia", whatsapp: "119" },
          jaExistia: false,
        }}
        despachar={vi.fn()}
        limparCupom={vi.fn()}
        aoAnular={vi.fn()}
      />,
    ),
  );
  expect(botao("Enviar por WhatsApp").disabled).toBe(true);
  expect(host.textContent).toContain(
    "Indisponível: WhatsApp do cliente inválido.",
  );
  expect(botao("Imprimir").disabled).toBe(false);
  expect(
    botao("Imprimir").compareDocumentPosition(botao("Anular venda")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    botao("Anular venda").compareDocumentPosition(botao("Nova venda")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("recibo mostra o total com desconto e só diz 'conferido' quando houve conferência", async () => {
  const base = {
    orderId: "p2",
    numero: "ABC124",
    criadoEm: "2026-10-17T15:00:00Z",
    itens: [item],
    subtotal: 1198.8,
    desconto: 5,
    total: 1193.8,
    cliente: { tipo: "avulso" as const, nome: "Lia", whatsapp: "11999990000" },
    jaExistia: false,
  };
  await act(async () =>
    raiz.render(
      <ReciboDaVenda
        recibo={{ ...base, pagamento: "pix" }}
        despachar={vi.fn()}
        limparCupom={vi.fn()}
        aoAnular={vi.fn()}
      />,
    ),
  );
  const totais = [...host.querySelectorAll(".pdv-total")];
  const linhaTotal = totais.find((l) => l.textContent?.startsWith("Total"))!;
  expect(linhaTotal.querySelector("strong")!.textContent).toBe("R$ 1.193,80");
  expect(host.textContent).toContain("Pagamento conferido pelo lojista");
  await act(async () =>
    raiz.render(
      <ReciboDaVenda
        recibo={{ ...base, pagamento: "cash" }}
        despachar={vi.fn()}
        limparCupom={vi.fn()}
        aoAnular={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).not.toContain("Pagamento conferido pelo lojista");
});
