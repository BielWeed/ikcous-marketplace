// @vitest-environment jsdom
//
// O passo a passo do Melhor Envio sugeria dar ao token o nome "IKCOUS
// Marketplace" para qualquer lojista (caça 12-E #6). O nome sugerido agora é
// o da própria loja, sem citar marca nenhuma.
import { GuiaDaChaveDoProvedor } from "@/components/admin/settings/GuiaDaChaveDoProvedor";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("guia da chave do Melhor Envio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  it("sugere o nome da loja e não cita a marca de outra loja", () => {
    act(() => {
      raiz.render(<GuiaDaChaveDoProvedor provider="melhor_envio" />);
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("o nome da sua loja");
    expect(texto).not.toMatch(/ikcous/i);
  });
});
