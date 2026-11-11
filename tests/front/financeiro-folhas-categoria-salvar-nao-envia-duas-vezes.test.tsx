// @vitest-environment jsdom
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CategoriaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";
import {
  type ConfirmacaoFinanceira,
  ContextoConfirmacaoFinanceira,
  ReciboFinanceiro,
} from "@/components/admin/financeiro/partes";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { salvarCategoria } = vi.hoisted(() => ({
  salvarCategoria: vi.fn<() => Promise<void>>(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/hooks/useFinanceiro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useFinanceiro")>()),
  salvarCategoria,
}));

let raiz: Root;
let hospedeiro: HTMLDivElement;

function Formulario() {
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoFinanceira | null>(
    null,
  );
  return (
    <ContextoConfirmacaoFinanceira.Provider value={setConfirmacao}>
      <CategoriaFolha
        categoria={null}
        aoFechar={vi.fn()}
        aoSalvar={vi.fn()}
        aoMudarSujo={vi.fn()}
      />
      {confirmacao ? (
        <ReciboFinanceiro
          confirmacao={confirmacao}
          aoFechar={() => setConfirmacao(null)}
        />
      ) : null}
    </ContextoConfirmacaoFinanceira.Provider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  salvarCategoria.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

it("dois cliques no mesmo render criam a categoria só uma vez e mostram a confirmação", async () => {
  let concluir!: () => void;
  salvarCategoria.mockReturnValue(
    new Promise<void>((resolve) => {
      concluir = resolve;
    }),
  );
  await act(async () => raiz.render(<Formulario />));

  const campo = document.getElementById(
    "fin-categoria-nome",
  ) as HTMLInputElement;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, "Aluguel da loja");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
  });

  const salvar = [...document.querySelectorAll("button")].find(
    (botao) => botao.textContent?.trim() === "Salvar",
  );
  if (!salvar) throw new Error("Botão Salvar não existe");
  expect(salvar.disabled).toBe(false);

  // Sem aguardar entre cliques: o segundo ainda enxerga enviando=false.
  act(() => {
    salvar.click();
    salvar.click();
  });

  expect(salvarCategoria).toHaveBeenCalledTimes(1);
  expect(salvarCategoria).toHaveBeenCalledWith({
    nome: "Aluguel da loja",
    natureza: "despesa",
    grupo_dre: "despesa_fixa",
    ativa: true,
  });
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(salvar.disabled).toBe(true);

  await act(async () => concluir());

  const recibo = document.querySelector('[role="status"]');
  expect(recibo?.getAttribute("aria-label")).toBe("Categoria criada.");
  expect(recibo?.textContent).toContain("Aluguel da loja");
  expect(salvarCategoria).toHaveBeenCalledTimes(1);
});
