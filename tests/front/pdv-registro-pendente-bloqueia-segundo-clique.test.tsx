// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import { useVendaPresencial } from "@/hooks/useVendaPresencial";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const armazenamento = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function Venda({ registrar }: { registrar: () => Promise<void> }) {
  const { estado, despachar, limparCupom } = useVendaPresencial({
    armazenamento,
  });
  useEffect(() => {
    despachar({
      tipo: "item_adicionado_manualmente",
      em: 1000,
      item: {
        chave: "produto-teste::",
        productId: "produto-teste",
        variantId: null,
        nome: "Camiseta de teste",
        variacao: null,
        preco: 10,
        quantidade: 1,
        estoque: 5,
        imagem: "",
      },
    });
    despachar({ tipo: "pagamento_escolhido", pagamento: "cash" });
  }, [despachar]);
  return (
    <FechamentoDaVenda
      estado={estado}
      despachar={despachar}
      limparCupom={limparCupom}
      aoRegistrarVenda={registrar}
    />
  );
}

it("durante o registro pendente, desabilita o botão e não registra duas vezes", async () => {
  const registrar = vi.fn(() => new Promise<void>(() => {}));
  const elemento = document.createElement("div");
  document.body.appendChild(elemento);
  const raiz = createRoot(elemento);
  try {
    await act(async () => {
      raiz.render(<Venda registrar={registrar} />);
    });
    const botao = [...elemento.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Registrar venda"),
    );
    expect(botao).toBeTruthy();
    expect(botao?.disabled).toBe(false);
    await act(async () => {
      botao?.click();
    });
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(botao?.textContent).toContain("Registrando");
    expect(botao?.disabled).toBe(true);
    await act(async () => {
      botao?.click();
    });
    expect(registrar).toHaveBeenCalledTimes(1);
  } finally {
    act(() => raiz.unmount());
    elemento.remove();
  }
});
