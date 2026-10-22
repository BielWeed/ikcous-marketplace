// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AbaVisao } from "@/components/admin/financeiro/AbaVisao";
import {
  IconeDaForma,
  corDaForma,
} from "@/components/admin/financeiro/IconeDaForma";
import { parseResumo } from "@/lib/financeiro";

const FORMAS_CONHECIDAS = [
  "pix",
  "dinheiro",
  "cash",
  "credito",
  "cartao_credito",
  "debito",
  "cartao_debito",
  "cartao",
  "card",
  "boleto",
  "transferencia",
  "online",
  "online_desconhecido",
  "outro",
];

const estado = vi.hoisted(() => ({
  formas: [] as { forma: string | null; valor: number }[],
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
  estado.formas = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function montarAba() {
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

it("toda forma conhecida renderiza um ícone decorativo", () => {
  for (const forma of FORMAS_CONHECIDAS) {
    act(() => root.render(<IconeDaForma forma={forma} />));
    const svg = host.querySelector("svg");
    expect(svg, forma).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden"), forma).toBe("true");
  }
});

it("forma nula, vazia ou desconhecida cai no ícone de outras, nunca vazio", () => {
  const outra = (() => {
    act(() => root.render(<IconeDaForma forma="outro" />));
    return host.innerHTML;
  })();
  for (const forma of [null, undefined, "", "xyz_inventada"]) {
    act(() => root.render(<IconeDaForma forma={forma} />));
    expect(host.querySelector("svg"), String(forma)).not.toBeNull();
    expect(host.innerHTML, String(forma)).toBe(outra);
  }
});

it("cores: pix teal, crédito roxo, demais azul", () => {
  expect(corDaForma("pix")).toBe("#2DD4BF");
  expect(corDaForma("credito")).toBe("#BA9AFF");
  expect(corDaForma("dinheiro")).toBe("#7AA2FF");
  expect(corDaForma(null)).toBe("#7AA2FF");
});

it("na aba Visão cada linha tem ícone: Pix na classe de tema, demais neutros; barra com corDaForma", async () => {
  estado.formas = [
    { forma: "pix", valor: 40 },
    { forma: "credito", valor: 30 },
    { forma: "dinheiro", valor: 20 },
    { forma: null, valor: 10 },
  ];
  await montarAba();
  const linhas = [...host.querySelectorAll("li")].filter((li) =>
    li.querySelector("[data-barra-da-forma]"),
  );
  expect(linhas).toHaveLength(4);
  for (const li of linhas) {
    const icone = li.querySelector("svg[aria-hidden='true']") as SVGElement;
    const barra = li.querySelector("[data-barra-da-forma]") as HTMLElement;
    expect(icone).not.toBeNull();
    const forma = barra.getAttribute("data-barra-da-forma") || null;
    expect(barra.style.backgroundColor).toBe(corParaRgb(corDaForma(forma)));
    const classe = icone.getAttribute("class") ?? "";
    expect(icone.style.color).toBe("");
    if (forma === "pix") {
      expect(classe).toContain("text-teal-300");
    } else {
      expect(classe).toContain("text-zinc-400");
      expect(classe).not.toMatch(/text-(teal|violet|purple|blue|sky)/);
    }
  }
});

function corParaRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}
