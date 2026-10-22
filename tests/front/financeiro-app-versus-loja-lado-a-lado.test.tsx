// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AbaVisao } from "@/components/admin/financeiro/AbaVisao";
import { parseResumo } from "@/lib/financeiro";

const estado = vi.hoisted(() => ({
  canal: { online: 418.98, presencial: 34.9 },
}));
vi.mock("@/hooks/useFinanceiro", () => ({
  useResumoFinanceiro: () => ({
    dados: parseResumo({ por_canal: estado.canal }),
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
  estado.canal = { online: 418.98, presencial: 34.9 };
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

function blocos() {
  const grade = host.querySelector("[data-canais-lado-a-lado]") as HTMLElement;
  const colunas = grade ? [...grade.children] : [];
  return { grade, colunas: colunas as HTMLElement[] };
}

const normaliza = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").replace(/ /g, " ");

it("mostra App e Loja física em duas colunas, com texto normal e valores certos", async () => {
  await montar();
  const { grade, colunas } = blocos();
  expect(grade).not.toBeNull();
  expect(grade.className).toMatch(/\bgrid-cols-2\b/);
  expect(colunas).toHaveLength(2);
  expect(normaliza(colunas[0].textContent)).toContain("App");
  expect(normaliza(colunas[0].textContent)).toContain("418,98");
  expect(normaliza(colunas[0].textContent)).toContain("92,3%");
  expect(normaliza(colunas[1].textContent)).toContain("Loja física");
  expect(normaliza(colunas[1].textContent)).toContain("34,90");
  expect(normaliza(colunas[1].textContent)).toContain("7,7%");
  // rótulo em texto normal, sem MAIÚSCULAS espaçadas
  expect(grade.innerHTML).not.toMatch(/uppercase|tracking-\[0\.2em\]/);
});

it("o ponto colorido de cada coluna tem a cor do trecho da barra", async () => {
  await montar();
  const { colunas } = blocos();
  const cores = [...host.querySelectorAll("[data-trecho-do-canal]")].map(
    (e) => (e as HTMLElement).style.background,
  );
  const pontos = colunas.map(
    (c) =>
      (c.querySelector("[data-ponto-do-canal]") as HTMLElement).style
        .background,
  );
  expect(cores).toHaveLength(2);
  expect(pontos).toEqual(cores);
});

it("só app: a coluna da loja fica visível com R$ 0,00 e 0%", async () => {
  estado.canal = { online: 100, presencial: 0 };
  await montar();
  const { colunas } = blocos();
  expect(colunas).toHaveLength(2);
  expect(normaliza(colunas[0].textContent)).toContain("100,0%");
  expect(normaliza(colunas[1].textContent)).toContain("Loja física");
  expect(normaliza(colunas[1].textContent)).toContain("0,00");
  expect(normaliza(colunas[1].textContent)).toMatch(/\b0%/);
});

it("só loja física: a coluna do app fica visível com R$ 0,00 e 0%", async () => {
  estado.canal = { online: 0, presencial: 50 };
  await montar();
  const { colunas } = blocos();
  expect(colunas).toHaveLength(2);
  expect(normaliza(colunas[0].textContent)).toContain("0,00");
  expect(normaliza(colunas[0].textContent)).toMatch(/\b0%/);
  expect(normaliza(colunas[1].textContent)).toContain("100,0%");
});

it("sem vendas mantém a mensagem de vazio, sem colunas", async () => {
  estado.canal = { online: 0, presencial: 0 };
  await montar();
  expect(host.textContent).toContain("Nenhuma venda recebida no período.");
  expect(host.querySelector("[data-canais-lado-a-lado]")).toBeNull();
});
