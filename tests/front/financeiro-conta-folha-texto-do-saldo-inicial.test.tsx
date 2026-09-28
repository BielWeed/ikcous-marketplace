// @vitest-environment jsdom
//
// Revisão independente do achado #4: o texto de ajuda do campo "Na data"
// (ContaFolha, FolhasDeCadastro.tsx) dizia "o saldo de hoje é o saldo
// inicial mais tudo o que entrou e menos tudo o que SAIU DEPOIS dessa
// data" — mas `fin__saldos` (migration 20261177000000, `m.data >=
// c.saldo_inicial_em`) conta o PRÓPRIO dia do saldo inicial também, não só
// "depois" dele. O valor informado é o saldo no COMEÇO daquele dia, antes
// dos lançamentos dele — não "depois". Este teste trava o texto certo (e
// falha se o texto errado voltar).
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa (ver
// tests/front/admin-financeiro-novo-lancamento.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { ContaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";

function folha(): HTMLElement {
  const el = document.querySelector('[data-slot="sheet-content"]');
  if (!el) throw new Error("folha não abriu");
  return el as HTMLElement;
}

describe("ContaFolha — texto de ajuda do saldo inicial não mente sobre o próprio dia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    rpcFalso.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <ContaFolha
          conta={null}
          hoje="2026-09-27"
          aoFechar={vi.fn()}
          aoSalvar={vi.fn()}
          aoMudarSujo={vi.fn()}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("diz que o valor é do COMEÇO do dia (antes dos lançamentos dele), não 'depois dessa data'", () => {
    const texto = (folha().textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain("no começo desse dia");
    expect(texto).toContain("antes dos lançamentos dele");
    // O texto antigo — tecnicamente errado, `fin__saldos` conta o PRÓPRIO
    // dia do saldo inicial (`m.data >= saldo_inicial_em`), não só "depois"
    // dele — não pode voltar.
    expect(texto).not.toContain("menos tudo o que saiu depois dessa data");
  });
});
