// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import {
  CategoriaFolha,
  ContaFolha,
} from "@/components/admin/financeiro/FolhasDeCadastro";
import { ContextoConfirmacaoFinanceira } from "@/components/admin/financeiro/partes";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { salvarConta, salvarCategoria } = vi.hoisted(() => ({
  salvarConta: vi.fn(),
  salvarCategoria: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/hooks/useFinanceiro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useFinanceiro")>()),
  salvarConta,
  salvarCategoria,
}));

afterEach(() => vi.clearAllMocks());

for (const tipo of ["conta", "categoria"] as const) {
  for (const semResposta of [false, true]) {
    it(`Enter salva ${tipo} com o nome atual, sem duplicar (resposta perdida: ${semResposta})`, async () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const salvar = tipo === "conta" ? salvarConta : salvarCategoria;
      let concluir!: () => void;
      salvar.mockReturnValue(
        new Promise<void>((resolve, reject) => {
          concluir = () =>
            semResposta ? reject(new TypeError("Failed to fetch")) : resolve();
        }),
      );
      try {
        await act(async () =>
          root.render(
            <ContextoConfirmacaoFinanceira.Provider value={vi.fn()}>
              {tipo === "conta" ? (
                <ContaFolha
                  conta={null}
                  hoje="2026-11-12"
                  aoFechar={vi.fn()}
                  aoSalvar={vi.fn()}
                  aoMudarSujo={vi.fn()}
                />
              ) : (
                <CategoriaFolha
                  categoria={null}
                  aoFechar={vi.fn()}
                  aoSalvar={vi.fn()}
                  aoMudarSujo={vi.fn()}
                />
              )}
            </ContextoConfirmacaoFinanceira.Provider>,
          ),
        );
        const campo = document.getElementById(
          `fin-${tipo}-nome`,
        ) as HTMLInputElement;
        await act(async () => {
          campo.focus();
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set?.call(campo, "Nome digitado");
          campo.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
          campo.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              isComposing: true,
              bubbles: true,
            }),
          );
          campo.dispatchEvent(
            new KeyboardEvent("keydown", { key: "a", bubbles: true }),
          );
        });
        expect(salvar).not.toHaveBeenCalled();
        await act(async () => {
          campo.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              cancelable: true,
            }),
          );
          campo.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              cancelable: true,
            }),
          );
        });
        expect(salvar).toHaveBeenCalledOnce();
        expect(salvar.mock.calls[0][0].nome).toBe("Nome digitado");
        await act(async () => concluir());
        if (semResposta) {
          await act(async () => {
            campo.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                bubbles: true,
                cancelable: true,
              }),
            );
          });
          expect(salvar).toHaveBeenCalledOnce();
          expect(
            [...document.querySelectorAll("button")].find(
              (b) => b.textContent === "Salvar",
            )?.disabled,
          ).toBe(true);
        }
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    });
  }
}
