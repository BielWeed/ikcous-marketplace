// @vitest-environment jsdom
import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CEP de origem só conclui o checklist com oito dígitos", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it.each([
    { cep: "123", feito: false },
    { cep: "12345-678", feito: true },
    { cep: "12345678", feito: true },
    { cep: "   ", feito: false },
    { cep: "", feito: false },
    { cep: undefined, feito: false },
    { cep: "1234567", feito: false },
    { cep: "123456789", feito: false },
    { cep: "abcdefgh", feito: false },
    { cep: "abc12345678", feito: false },
    { cep: "12345--678", feito: false },
    { cep: "1234-5678", feito: false },
    { cep: " 12345-678 ", feito: true },
  ])("CEP $cep: feito=$feito", async ({ cep, feito }) => {
    const onNavigate = vi.fn();
    await act(async () => {
      raiz.render(
        <LojaProntaEEstoqueBaixo
          stats={{ inventoryAlerts: 0 }}
          originCep={cep}
          ligado={true}
          chaveOk={true}
          produtos={[{ isActive: true }]}
          configCarregando={false}
          produtosCarregando={false}
          onNavigate={onNavigate}
          onTentarDeNovo={vi.fn()}
        />,
      );
    });

    const itemCep = Array.from(hospedeiro.querySelectorAll("ul > li")).find(
      (item) => item.textContent?.includes("CEP"),
    );
    expect(itemCep).toBeDefined();
    if (feito) {
      expect(itemCep?.textContent).toContain(
        "CEP de origem do frete preenchido",
      );
      expect(itemCep?.querySelector("button")).toBeNull();
      expect(hospedeiro.textContent).toContain("está pronta para vender.");
    } else {
      expect(itemCep?.textContent).toContain(
        "Cadastrar CEP de origem do frete",
      );
      expect(hospedeiro.textContent).not.toContain("está pronta para vender.");
      const botao = itemCep?.querySelector("button");
      expect(botao).toBeTruthy();
      await act(async () => botao?.click());
      expect(onNavigate).toHaveBeenCalledWith("admin-shipping");
    }
  });
});
