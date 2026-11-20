// @vitest-environment jsdom

import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { pendentesRecomendados } from "@/lib/passos-recomendados";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("o atalho recomendado do PIX abre Ajustes na aba Pagamentos", async () => {
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  const onNavigate = vi.fn();

  try {
    await act(async () => {
      raiz.render(
        <LojaProntaEEstoqueBaixo
          stats={{ inventoryAlerts: 0 }}
          config={{}}
          ligado={false}
          chaveOk={false}
          formasNaEntrega={["cash"]}
          produtos={[{ isActive: true, stock: 5 }]}
          configCarregando={false}
          produtosCarregando={false}
          recomendados={pendentesRecomendados({
            email: "desconhecido",
            pixOk: false,
            pagamentoPeloAppLigado: false,
            nomesLigados: null,
            config: {},
            configCarregando: false,
          })}
          onNavigate={onNavigate}
          onTentarDeNovo={vi.fn()}
        />,
      );
    });

    const atalho = Array.from(hospedeiro.querySelectorAll("button")).find(
      (botao) =>
        botao.textContent?.includes("Ligar o pagamento pelo app (PIX)"),
    );
    expect(atalho).toBeDefined();
    await act(async () => {
      atalho?.click();
    });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(
      "admin-settings",
      "pagamentos",
    );
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
  }
});
