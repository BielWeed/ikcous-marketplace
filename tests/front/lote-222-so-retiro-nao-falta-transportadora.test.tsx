// @vitest-environment jsdom
//
// Lote 222 (C1): loja "Só retiro" aceita qualquer CEP retirando, então o
// painel não pode dizer que falta transportadora nem que "não compra".
import { PreviaDoFrete } from "@/components/admin/shipping/PreviaDoFrete";
import { situacaoDaEntrega } from "@/lib/status-da-entrega";
import type { StoreConfig } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const soRetiro = {
  originCep: "38400-000",
  localDeliveryEnabled: false,
  shippingCoverage: "national",
  storeAddress: "Rua A, 10",
} as unknown as StoreConfig;

describe("lote 222 — Só retiro não pede transportadora", () => {
  it("situacaoDaEntrega: sem transportadora e cobertura nacional, sem pendência", () => {
    const s = situacaoDaEntrega(soRetiro, [], false);
    expect(s.faltaTransportadora).toBe(false);
    expect(s.pendencias).toBe(0);
  });

  it("controle: entregando, sem transportadora, ainda falta", () => {
    const s = situacaoDaEntrega(
      { ...soRetiro, localDeliveryEnabled: true } as StoreConfig,
      [],
      false,
    );
    expect(s.faltaTransportadora).toBe(true);
  });

  it("prévia: quem é de fora retira de graça, não 'Não compra'", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const raiz = createRoot(host);
    act(() => {
      raiz.render(
        <PreviaDoFrete config={soRetiro} nomesLigados={[]} pendente={false} />,
      );
    });
    const texto = host.textContent ?? "";
    expect(texto).not.toContain("Não compra");
    expect(texto).toContain("Só retirada");
    act(() => raiz.unmount());
    host.remove();
  });
});
