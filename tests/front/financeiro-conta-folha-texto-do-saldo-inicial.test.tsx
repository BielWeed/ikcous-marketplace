// @vitest-environment jsdom
//
// Revisão independente do texto de ajuda do campo "Na data" (ContaFolha,
// FolhasDeCadastro.tsx). Duas rodadas de correção sobre o mesmo texto:
//
// 1ª rodada: dizia "o saldo de hoje é o saldo inicial mais tudo o que
// entrou e menos tudo o que SAIU DEPOIS dessa data" — mas `fin__saldos`
// (migration 20261177000000, `m.data >= c.saldo_inicial_em`) conta o
// PRÓPRIO dia do saldo inicial também, não só "depois" dele. Virou "no
// começo desse dia, antes dos lançamentos dele".
//
// 2ª rodada: a frase que sobrou ("lançamentos desse dia em diante entram no
// saldo de hoje") também é falsa para PREVISTOS — `fin__saldos` só soma
// `status = 'realizado'` e `data <= hoje` (função `fin__movimentos`, mesma
// migration). Um lançamento previsto para daqui a 10 dias NÃO entra no
// saldo de hoje, mesmo estando "desse dia em diante". Corrigido para falar
// só do que já foi pago/recebido, até hoje.
//
// Este teste trava o texto certo, o contraste do parágrafo (text-zinc-400 —
// text-zinc-500 mede ~4,12:1, abaixo de AA) e falha se qualquer um dos dois
// textos errados voltar.
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
    // O texto da 1ª rodada — tecnicamente errado, `fin__saldos` conta o
    // PRÓPRIO dia do saldo inicial (`m.data >= saldo_inicial_em`), não só
    // "depois" dele — não pode voltar.
    expect(texto).not.toContain("menos tudo o que saiu depois dessa data");
  });

  it("fala só do que já foi pago/recebido até hoje — não promete que previsto entra no saldo", () => {
    const texto = (folha().textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain("até hoje");
    expect(texto).toContain("já pagos ou recebidos");
    // O texto da 2ª rodada — também errado: `fin__saldos` só soma
    // `status = 'realizado'`, nunca `previsto`; "desse dia em diante" dava a
    // entender que um lançamento futuro (previsto) também contaria.
    expect(texto).not.toContain(
      "Lançamentos desse dia em diante entram no saldo de hoje.",
    );
  });

  it("o parágrafo de ajuda usa text-zinc-400, não text-zinc-500 (contraste AA)", () => {
    const paragrafo = [...folha().querySelectorAll("p")].find((p) =>
      (p.textContent ?? "").includes("no começo desse dia"),
    );
    expect(paragrafo).toBeTruthy();
    expect(paragrafo?.className).toContain("text-zinc-400");
    expect(paragrafo?.className).not.toContain("text-zinc-500");
  });
});
