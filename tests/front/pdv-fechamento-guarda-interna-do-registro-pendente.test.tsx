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

it("a guarda interna recusa outro registro pendente mesmo chamando o onClick diretamente", async () => {
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
    if (!botao) throw new Error("Botão Registrar venda não encontrado");
    expect(botao.disabled).toBe(false);
    expect(registrar).not.toHaveBeenCalled();
    await act(async () => {
      botao.click();
    });
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(botao.textContent).toContain("Registrando");
    expect(botao.disabled).toBe(true);

    // Ler DEPOIS do envio captura o handler do render com enviando=true.
    // Remover só o disabled do DOM não basta: o React também bloqueia o evento.
    const propsAtuais = Object.entries(botao).find(([chave]) =>
      chave.startsWith("__reactProps$"),
    )?.[1] as { disabled: boolean; onClick: () => Promise<void> } | undefined;
    if (!propsAtuais) throw new Error("Botão sem props atuais do React");
    expect(propsAtuais.disabled).toBe(true);
    expect(propsAtuais.onClick).toBeTypeOf("function");
    await act(async () => {
      // Não aguardar a promessa: sem a guarda, o segundo envio também fica pendente.
      void propsAtuais.onClick();
    });
    expect(registrar).toHaveBeenCalledTimes(1);
  } finally {
    act(() => raiz.unmount());
    elemento.remove();
  }
});
