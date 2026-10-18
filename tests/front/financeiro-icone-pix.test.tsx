// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AbaVisao } from "@/components/admin/financeiro/AbaVisao";
import { parseResumo } from "@/lib/financeiro";

const estado = vi.hoisted(() => ({
  formas: [
    { forma: "pix", valor: 20 },
    { forma: "dinheiro", valor: 10 },
  ],
}));
vi.mock("@/hooks/useFinanceiro", () => ({
  useResumoFinanceiro: () => ({
    dados: parseResumo({ por_forma: estado.formas }),
    erro: null,
    carregando: false,
    recarregar: vi.fn(),
  }),
}));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  estado.formas = [
    { forma: "pix", valor: 20 },
    { forma: "dinheiro", valor: 10 },
  ];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function montar() {
  await act(async () =>
    root.render(
      <AbaVisao
        ativo
        intervalo={null}
        hoje="2026-10-17"
        versao={0}
        contas={[]}
        irParaAba={vi.fn()}
        verPrevistos={vi.fn()}
      />,
    ),
  );
}

it("identifica só a linha PIX com o símbolo decorativo e mantém valores e ordem", async () => {
  await montar();
  const linhas = [...host.querySelectorAll("li")].filter((li) =>
    /PIX|Dinheiro/.test(li.textContent ?? ""),
  );
  expect(linhas).toHaveLength(2);
  expect(linhas[0].textContent).toContain("PIX");
  expect(linhas[0].textContent).toContain("20,00");
  expect(
    linhas[0].querySelector(".icone-pix")?.getAttribute("aria-hidden"),
  ).toBe("true");
  expect(linhas[1].textContent).toContain("Dinheiro");
  expect(linhas[1].textContent).toContain("10,00");
  expect(linhas[1].querySelector(".icone-pix")).toBeNull();
  expect(host.querySelectorAll(".icone-pix")).toHaveLength(1);
});

it("sem recebimentos mantém o estado vazio, sem um PIX inventado", async () => {
  estado.formas = [];
  await montar();
  expect(host.textContent).toContain("Nenhum recebimento no período.");
  expect(host.querySelector(".icone-pix")).toBeNull();
});
