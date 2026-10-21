// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));
import { AbaCaixa } from "@/components/admin/financeiro/AbaCaixa";
import { AbaPrevistos } from "@/components/admin/financeiro/AbaPrevistos";
import { AbaVisao } from "@/components/admin/financeiro/AbaVisao";
import { Etiqueta } from "@/components/admin/financeiro/partes";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  rpc.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const noop = () => {};
async function montar(elemento: React.ReactNode) {
  await act(async () => root.render(elemento));
}
function valor(rotulo: string) {
  const secao = host.querySelector(`section[aria-label="${rotulo}"]`)!;
  return secao.querySelector(".tabular-nums")!;
}

it("a receber e a pagar seguem entrada e saída no resumo, com saldo positivo verde", async () => {
  rpc.mockResolvedValue({
    data: {
      saldo_total: 120,
      a_pagar: { total: 20 },
      a_receber: { total: 40 },
    },
    error: null,
  });
  await montar(
    <AbaVisao
      ativo
      intervalo={{ inicio: "2026-09-01", fim: "2026-09-30" }}
      hoje="2026-09-30"
      versao={0}
      contas={[]}
      irParaAba={noop}
      verPrevistos={noop}
    />,
  );
  expect
    .soft(valor("A receber").classList.contains("text-emerald-400"))
    .toBe(true);
  expect.soft(valor("A pagar").classList.contains("text-red-400")).toBe(true);
  expect
    .soft(valor("Saldo total").classList.contains("text-emerald-400"))
    .toBe(true);
});

it.each([
  {
    lado: "entrada" as const,
    cor: "text-emerald-400",
    rotulo: "Total a receber",
  },
  { lado: "saida" as const, cor: "text-red-400", rotulo: "Total a pagar" },
])(
  "previstos: $rotulo, vencido vermelho e hoje âmbar sem borda de estado",
  async ({ lado, cor, rotulo }) => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "hoje",
          descricao: "Conta de hoje",
          valor: 20,
          vencimento: "2026-09-30",
          origem: "manual",
          editavel: true,
        },
        {
          id: "ontem",
          descricao: "Conta atrasada",
          valor: 40,
          vencimento: "2026-09-29",
          origem: "manual",
          editavel: true,
        },
      ],
      error: null,
    });
    await montar(
      <AbaPrevistos
        ativo
        hoje="2026-09-30"
        versao={0}
        lado={lado}
        aoMudarLado={noop}
        abrirFolha={noop}
        aoNovoLancamento={noop}
        aoAbrirPedido={noop}
      />,
    );
    expect.soft(valor(rotulo).classList.contains(cor)).toBe(true);
    const itens = [...host.querySelectorAll("li")];
    for (const [descricao, corDoPrazo] of [
      ["Conta de hoje", "text-amber-400"],
      ["Conta atrasada", "text-red-400"],
    ]) {
      const item = itens.find((el) => el.textContent?.includes(descricao))!;
      expect.soft(item.querySelector(`p.${corDoPrazo}`)).not.toBeNull();
      expect
        .soft(item.querySelector(`p.font-bold svg.${corDoPrazo}`))
        .not.toBeNull();
      expect
        .soft(item.querySelector(".text-2xl")?.classList.contains(cor))
        .toBe(true);
      expect.soft(item.classList.contains("border-admin-border")).toBe(true);
    }
  },
);

it.each([
  { contado: 90, cor: "text-red-400" },
  { contado: 110, cor: "text-amber-400" },
  { contado: 100, cor: "text-emerald-400" },
])(
  "diferença do histórico: contado $contado usa $cor",
  async ({ contado, cor }) => {
    rpc.mockImplementation(async (nome: string) => ({
      data:
        nome === "fin_caixa_atual"
          ? { sessao: null }
          : [
              {
                id: "sessao-prova",
                conta_nome: "Gaveta",
                aberto_em: "2026-09-30T10:00:00Z",
                fechado_em: "2026-09-30T18:00:00Z",
                esperado: 100,
                contado,
                diferenca: contado - 100,
              },
            ],
      error: null,
    }));
    await montar(<AbaCaixa ativo versao={0} abrirFolha={noop} />);
    const dt = [...host.querySelectorAll("dt")].find(
      (el) => el.textContent === "Diferença",
    );
    expect(dt?.nextElementSibling?.classList.contains(cor)).toBe(true);
  },
);

it.each([
  { tom: "aviso" as const, cor: "text-amber-400", ponto: "bg-amber-400" },
  { tom: "perigo" as const, cor: "text-red-400", ponto: "bg-red-400" },
  { tom: "sucesso" as const, cor: "text-emerald-400", ponto: "bg-emerald-400" },
])(
  "etiqueta $tom usa ponto e texto, nunca bloco pintado",
  async ({ tom, cor, ponto }) => {
    await montar(<Etiqueta tom={tom}>Estado legível</Etiqueta>);
    const estado = host.firstElementChild!;
    expect.soft(estado.classList.contains(cor)).toBe(true);
    expect
      .soft(estado.querySelector(`[aria-hidden="true"].${ponto}`))
      .not.toBeNull();
    expect.soft(estado.className).not.toMatch(/bg-.*\/|border-/);
    expect(estado.textContent).toBe("Estado legível");
  },
);
