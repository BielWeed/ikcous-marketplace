// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { rpc, lerCaixa } = vi.hoisted(() => ({
  rpc: vi.fn(),
  lerCaixa: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { AbaCaixa } from "@/components/admin/financeiro/AbaCaixa";
import { CONTA_CAIXA_DA_LOJA } from "@/types/financeiro";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const caixa = {
  id: "sessao-1",
  conta_id: CONTA_CAIXA_DA_LOJA,
  conta_nome: "Caixa da loja",
  aberto_em: "2026-11-13T11:00:00Z",
  valor_abertura: 100,
  vendas_dinheiro: 0,
  devolucoes_dinheiro: 0,
  entradas_manuais: 0,
  saidas_manuais: 0,
  esperado: 100,
  movimentos: [],
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T12:15:00Z"));
  lerCaixa.mockReset().mockResolvedValue({ data: caixa, error: null });
  rpc.mockReset().mockImplementation(async (nome: string) => {
    return nome === "fin_caixa_atual" ? lerCaixa() : { data: [], error: null };
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

const cartao = () =>
  hospedeiro.querySelector('section[aria-label="Esperado na gaveta"]')!;

async function clicar(rotulo: string) {
  const botao = [...hospedeiro.querySelectorAll("button")].find(
    (elemento) => elemento.textContent?.trim() === rotulo,
  );
  expect(botao).toBeDefined();
  await act(async () => botao!.click());
}

it("mostra a hora da última leitura boa e permite atualizar o esperado na gaveta", async () => {
  await act(async () => {
    raiz.render(<AbaCaixa ativo versao={0} abrirFolha={vi.fn()} />);
  });
  expect(cartao().textContent).toContain("conferido às 09:15");

  vi.setSystemTime(new Date("2026-11-13T15:40:00Z"));
  lerCaixa.mockResolvedValueOnce({ data: null, error: new Error("Falhou") });
  await clicar("Atualizar");
  expect(lerCaixa).toHaveBeenCalledTimes(2);
  expect(cartao().textContent).toContain("conferido às 09:15");
  expect(cartao().textContent).toContain("Valor de antes");

  vi.setSystemTime(new Date("2026-11-13T15:42:00Z"));
  lerCaixa.mockResolvedValueOnce({
    data: { ...caixa, esperado: 250 },
    error: null,
  });
  await clicar("Tentar de novo");
  expect(lerCaixa).toHaveBeenCalledTimes(3);
  expect(cartao().textContent).toContain("conferido às 12:42");
  expect(cartao().textContent).toContain("250,00");
  expect(cartao().textContent).not.toContain("Valor de antes");
});

it("mostra o dia da conferência quando o caixa atravessa a meia-noite", async () => {
  vi.setSystemTime(new Date("2026-11-13T02:55:00Z")); // dia 12, 23h55 em SP
  await act(async () => {
    raiz.render(<AbaCaixa ativo versao={0} abrirFolha={vi.fn()} />);
  });
  expect(cartao().querySelector("time")?.textContent).toBe(
    "conferido às 23:55",
  );

  vi.setSystemTime(new Date("2026-11-13T03:01:00Z"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(cartao().querySelector("time")?.textContent).toBe(
    "conferido em 12/11 às 23:55",
  );
  expect(lerCaixa).toHaveBeenCalledTimes(1);
});
