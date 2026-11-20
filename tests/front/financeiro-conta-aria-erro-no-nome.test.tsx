// @vitest-environment jsdom
import { ContaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";
import { ContextoConfirmacaoFinanceira } from "@/components/admin/financeiro/partes";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("liga o Nome ao alerta enquanto o nome estiver inválido", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <ContextoConfirmacaoFinanceira.Provider value={vi.fn()}>
          <ContaFolha
            conta={null}
            hoje="2026-11-20"
            aoFechar={vi.fn()}
            aoSalvar={vi.fn()}
            aoMudarSujo={vi.fn()}
          />
        </ContextoConfirmacaoFinanceira.Provider>,
      ),
    );
    const nome = document.querySelector<HTMLInputElement>("#fin-conta-nome")!;
    expect(nome.hasAttribute("aria-invalid")).toBe(false);
    expect(nome.hasAttribute("aria-describedby")).toBe(false);

    await act(async () => {
      nome.focus();
      nome.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const erro = document.getElementById("fin-conta-nome-erro")!;
    expect(erro.getAttribute("role")).toBe("alert");
    expect(nome.getAttribute("aria-invalid")).toBe("true");
    expect(nome.getAttribute("aria-describedby")).toBe(erro.id);

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(nome, "Conta de teste");
      nome.dispatchEvent(new Event("input", { bubbles: true }));
      nome.blur();
    });
    expect(document.getElementById(erro.id)).toBeNull();
    expect(nome.hasAttribute("aria-invalid")).toBe(false);
    expect(nome.hasAttribute("aria-describedby")).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
