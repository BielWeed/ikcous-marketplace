// @vitest-environment jsdom
//
// "Vendas por categoria": o Faturamento Total do rodapé é a soma das linhas
// que a lojista lê, centavo a centavo. Um pedido de R$ 10,00 com três itens
// de categorias diferentes dá 3,3333... para cada uma; a tela mostrava
// R$ 3,33 em cada linha (soma 9,99) e R$ 10,00 no rodapé. Desde a
// 20261620000000 o banco já devolve cada categoria em centavos pelo maior
// resto (3,34 + 3,33 + 3,33 = 10,00); a tela arredonda cada linha ao centavo
// e soma os centavos inteiros, então o rodapé nunca contradiz a lista, nem
// com um valor antigo guardado no aparelho.
import {
  type CategoryData,
  StrategicIntelligenceBlocks,
} from "@/components/admin/dashboard/StrategicIntelligenceBlocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));

// @ts-expect-error flag interna do React, sem tipo público.
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

const texto = () => (host.textContent ?? "").replace(/\s/g, " ");

/** Valores em reais de cada linha, na ordem da tela ("R$ 3,33" -> 333 centavos). */
function centavosDasLinhas(): number[] {
  return [...host.querySelectorAll("li")].map((linha) => {
    const valor = linha.querySelector("span.tabular-nums")?.textContent ?? "";
    const m = /R\$\s*([\d.]+),(\d{2})/.exec(valor.replace(/\s/g, " "));
    expect(m, `linha sem valor em reais: ${valor}`).not.toBeNull();
    return Number(m![1].replace(/\./g, "")) * 100 + Number(m![2]);
  });
}

function centavosDoRodape(): number {
  const m = /Faturamento Total: R\$\s*([\d.]+),(\d{2})/.exec(texto());
  expect(m, "rodapé do Faturamento Total ausente").not.toBeNull();
  return Number(m![1].replace(/\./g, "")) * 100 + Number(m![2]);
}

async function mostrar(categoryData: CategoryData[]) {
  await act(async () =>
    root.render(
      <StrategicIntelligenceBlocks
        categoryData={categoryData}
        loading={false}
      />,
    ),
  );
}

it("três categorias de 3,3333...: o rodapé é a soma das linhas mostradas", async () => {
  // O valor sem arredondar, como a RPC devolvia antes da 20261620000000 (e como
  // pode ter ficado guardado no aparelho).
  const terco = 10 / 3;
  await mostrar([
    { name: "Vestidos", value: terco, orders: 1, avg_ticket: 3.33 },
    { name: "Bolsas", value: terco, orders: 1, avg_ticket: 3.33 },
    { name: "Acessórios", value: terco, orders: 1, avg_ticket: 3.33 },
  ]);
  const linhas = centavosDasLinhas();
  expect(linhas).toEqual([333, 333, 333]);
  expect(centavosDoRodape()).toBe(
    linhas.reduce((soma, centavos) => soma + centavos, 0),
  );
});

it("com o maior resto do banco (3,34 + 3,33 + 3,33) o rodapé fecha em R$ 10,00", async () => {
  await mostrar([
    { name: "Acessórios", value: 3.34, orders: 1, avg_ticket: 3.34 },
    { name: "Bolsas", value: 3.33, orders: 1, avg_ticket: 3.33 },
    { name: "Vestidos", value: 3.33, orders: 1, avg_ticket: 3.33 },
  ]);
  expect(centavosDasLinhas()).toEqual([334, 333, 333]);
  expect(texto()).toContain("Faturamento Total: R$ 10,00");
});

it("soma em centavos inteiros: 0,10 + 0,20 + 0,01 não vira 0,31000000000000005", async () => {
  await mostrar([
    { name: "Vestidos", value: 0.2, orders: 1 },
    { name: "Bolsas", value: 0.1, orders: 1 },
    { name: "Acessórios", value: 0.01, orders: 1 },
  ]);
  expect(centavosDasLinhas()).toEqual([20, 10, 1]);
  expect(centavosDoRodape()).toBe(31);
});

it("mais de três categorias: o rodapé, depois de expandir, é a soma de TODAS as linhas", async () => {
  const setimo = 100 / 7; // 14,2857... cada; 7 linhas de 14,29 somam 100,03
  await mostrar(
    ["A", "B", "C", "D", "E", "F", "G"].map((letra) => ({
      name: `Categoria ${letra}`,
      value: setimo,
      orders: 1,
    })),
  );
  const botao = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Ver todas as 7 categorias",
  );
  expect(botao).toBeDefined();
  act(() => botao!.click());
  const linhas = centavosDasLinhas();
  expect(linhas).toHaveLength(7);
  expect(centavosDoRodape()).toBe(
    linhas.reduce((soma, centavos) => soma + centavos, 0),
  );
});
