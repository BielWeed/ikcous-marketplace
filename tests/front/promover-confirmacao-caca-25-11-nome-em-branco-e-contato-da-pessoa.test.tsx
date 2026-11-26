// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) — confirmação de "Dar acesso de administrador".
// RISCO: permissão. A pergunta tem de dizer QUEM é a pessoa, sem espaços
// soltos e sem inventar um nome em branco: quem dá acesso ao painel precisa
// reconhecer o cliente antes de tocar em confirmar.
//
// O que os testes antigos não viam (eles só usam nome e contato "limpos"):
//  - nome só com espaços cai em "esta pessoa" (nunca "a   ?");
//  - nome com espaços nas pontas aparece sem eles;
//  - o contato junta e-mail e telefone com " · ", sem espaços nas pontas, e
//    some quando os dois estão vazios ou em branco.
// Dados inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { PromoverAdminConfirmacao } from "@/components/admin/users/PromoverAdminConfirmacao";
import type { Customer } from "@/utils/admin_cache";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function cliente(over: Partial<Customer> = {}): Customer {
  return {
    id: "cli-1",
    email: "pessoa@exemplo.invalid",
    full_name: "Maria Teste",
    phone: "11900000000",
    role: "customer",
    created_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("confirmação de cargo: quem é a pessoa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.removeAttribute("style");
    document.body.className = "";
  });

  function abrir(c: Customer, acao: "promover" | "remover" = "promover") {
    act(() => {
      raiz.render(
        <PromoverAdminConfirmacao
          acao={acao}
          aberta
          customer={c}
          aoFechar={vi.fn()}
          aoConcluir={vi.fn()}
          retornoDoFoco={{ current: null }}
        />,
      );
    });
  }

  const titulo = () =>
    document.body.querySelector('[role="alertdialog"] h2')?.textContent;
  const contato = () =>
    document.body.querySelector('[data-testid="promover-quem"]')?.textContent;

  it("nome só com espaços cai em 'esta pessoa' (promover e remover)", () => {
    abrir(cliente({ full_name: "     " }));
    expect(titulo()).toBe("Dar acesso de administrador a esta pessoa?");
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    abrir(cliente({ full_name: "   " }), "remover");
    expect(titulo()).toBe("Tirar o acesso de administrador de esta pessoa?");
  });

  it("nome nulo também cai em 'esta pessoa'", () => {
    abrir(cliente({ full_name: null }));
    expect(titulo()).toBe("Dar acesso de administrador a esta pessoa?");
  });

  it("nome com espaços nas pontas aparece sem eles", () => {
    abrir(cliente({ full_name: "  Maria Teste  " }));
    expect(titulo()).toBe("Dar acesso de administrador a Maria Teste?");
  });

  it("o contato junta e-mail e telefone com ' · ', sem espaços nas pontas", () => {
    abrir(
      cliente({ email: "  pessoa@exemplo.invalid ", phone: " 11900000000  " }),
    );
    expect(contato()).toBe("pessoa@exemplo.invalid · 11900000000");
  });

  it("só um dos dois: aparece sozinho, sem ' · ' sobrando", () => {
    abrir(cliente({ email: "pessoa@exemplo.invalid", phone: "   " }));
    expect(contato()).toBe("pessoa@exemplo.invalid");
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    abrir(cliente({ email: null, phone: "11900000000" }));
    expect(contato()).toBe("11900000000");
  });

  it("sem e-mail nem telefone (ou em branco) a linha do contato nem existe", () => {
    abrir(cliente({ email: "  ", phone: null }));
    expect(
      document.body.querySelector('[data-testid="promover-quem"]'),
    ).toBeNull();
  });
});
