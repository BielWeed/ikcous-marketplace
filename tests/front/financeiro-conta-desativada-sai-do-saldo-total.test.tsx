// @vitest-environment jsdom
//
// Conta desativada não entra no "Saldo total" da Visão (`fin_resumo` soma só
// `ativa = true`), mas a aba Contas e categorias segue listando a conta com o
// saldo dela. O aviso do interruptor "Conta ativa" tem que dizer essa
// consequência (o subtítulo do cartão do saldo é coberto em
// financeiro-casca-e-visao-nova.test.tsx). A categoria desativada não mexe em
// saldo: o aviso dela não muda.
import {
  CategoriaFolha,
  ContaFolha,
} from "@/components/admin/financeiro/FolhasDeCadastro";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

const folhaTexto = () =>
  (
    document.querySelector('[data-slot="sheet-content"]')?.textContent ?? ""
  ).replace(/\s+/g, " ");

describe("Financeiro: o aviso de desativar diz o que acontece com o saldo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcFalso.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("conta: avisa que o saldo da conta desativada sai do Saldo total", async () => {
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
    const texto = folhaTexto();
    expect(texto).toContain("some das escolhas de novos lançamentos");
    expect(texto).toContain("saldo dela sai do Saldo total");
  });

  it("categoria: o aviso continua só sobre as escolhas (categoria não tem saldo)", async () => {
    await act(async () => {
      raiz.render(
        <CategoriaFolha
          categoria={null}
          aoFechar={vi.fn()}
          aoSalvar={vi.fn()}
          aoMudarSujo={vi.fn()}
        />,
      );
    });
    const texto = folhaTexto();
    expect(texto).toContain("some das escolhas de novos lançamentos");
    expect(texto).not.toContain("Saldo total");
  });
});
