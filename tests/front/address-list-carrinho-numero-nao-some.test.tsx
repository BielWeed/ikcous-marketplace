// @vitest-environment jsdom
import { AddressList } from "@/components/ui/custom/AddressList";
import type { Address } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("carrinho deixa o endereço longo quebrar sem esconder o número que distingue as casas", () => {
  const endereco: Address = {
    id: "casa-1",
    user_id: "cliente-teste",
    name: "Casa",
    recipient_name: "Pessoa Teste",
    cep: "00000-000",
    street: "Avenida de Nome Muito Longo Para Conferir o Numero da Casa",
    number: "3477",
    complement: null,
    neighborhood: "Centro",
    city: "Cidade Teste",
    state: "MG",
    reference: null,
    is_default: false,
  };
  const selecionar = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <AddressList
          addresses={[endereco, { ...endereco, id: "casa-2", number: "1811" }]}
          compact
          selectable
          selectedId={endereco.id}
          onSelect={selecionar}
        />,
      ),
    );
    const cartoes = [...host.querySelectorAll('[role="button"]')];
    expect(cartoes).toHaveLength(2);
    for (const [cartao, numero] of [
      [cartoes[0], "3477"],
      [cartoes[1], "1811"],
    ] as const) {
      const texto = cartao.querySelector("p");
      expect(texto?.textContent).toBe(
        `${endereco.street}, ${numero} • Cidade Teste`,
      );
      expect(texto?.classList.contains("break-words")).toBe(true);
      expect(texto?.className).not.toMatch(
        /truncate|line-clamp|overflow-hidden|whitespace-nowrap/,
      );
    }
    expect(cartoes[0].textContent).toContain("Selecionado");
    act(() => (cartoes[1] as HTMLElement).click());
    expect(selecionar).toHaveBeenCalledWith(
      expect.objectContaining({ id: "casa-2", number: "1811" }),
    );
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
