// @vitest-environment jsdom
import { AddressList } from "@/components/ui/custom/AddressList";
import type { Address } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CASA: Address = {
  id: "casa-escola",
  user_id: "pessoa-teste",
  name: "Casa",
  recipient_name: "Pessoa de teste",
  cep: "38600-000",
  street: "Rua de teste",
  number: "S/N",
  complement: "Porteira",
  neighborhood: "Bairro de teste",
  city: "Paracatu",
  state: "MG",
  reference: "porteira perto da escola",
  is_default: false,
};

describe("AddressList — referência distingue endereços no checkout", () => {
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
  });

  function renderizar(addresses: Address[]) {
    act(() =>
      raiz.render(
        <AddressList addresses={addresses} selectable onSelect={() => {}} />,
      ),
    );
  }

  it("mostra cada referência abaixo do complemento, sem mudar os outros campos", () => {
    renderizar([
      CASA,
      { ...CASA, id: "casa-igreja", reference: "porteira perto da igreja" },
    ]);
    const linhas = [...hospedeiro.querySelectorAll("p")].filter((linha) =>
      linha.textContent?.startsWith("Referência:"),
    );
    expect(linhas.map((linha) => linha.textContent)).toEqual([
      "Referência: porteira perto da escola",
      "Referência: porteira perto da igreja",
    ]);
    for (const linha of linhas) {
      expect(linha.previousElementSibling?.textContent).toBe(
        "Rua de teste, S/N - Porteira",
      );
      expect(linha.nextElementSibling?.textContent).toBe(
        "Bairro de teste, Paracatu - MG",
      );
    }
  });

  it.each([null, "", "   "])(
    "não cria linha quando a referência é %s",
    (reference) => {
      renderizar([{ ...CASA, reference }]);
      expect(hospedeiro.textContent).not.toContain("Referência:");
    },
  );

  it("limita a referência longa a duas linhas com quebra segura", () => {
    const reference = "porteira".repeat(100);
    renderizar([{ ...CASA, reference }]);
    const linha = [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Referência:"),
    );
    expect(linha?.textContent).toBe(`Referência: ${reference}`);
    expect(linha?.classList.contains("break-words")).toBe(true);
    expect(linha?.classList.contains("line-clamp-2")).toBe(true);
  });
});
