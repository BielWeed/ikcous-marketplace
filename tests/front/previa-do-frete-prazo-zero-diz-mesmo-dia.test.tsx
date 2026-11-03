// @vitest-environment jsdom
//
// Prévia do painel com prazo 0 na entrega local diz "no mesmo dia", igual ao
// que a cliente vê na loja (caça, achado c2). Antes: "chega em 0 dias".
import { PreviaDoFrete } from "@/components/admin/shipping/PreviaDoFrete";
import type { StoreConfig } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function textoDaPrevia(dias: number | undefined): string {
  const config = {
    originCep: "38400-000",
    localDeliveryEnabled: true,
    localDeliveryFee: 10,
    localDeliveryDays: dias,
    shippingCoverage: "local",
    storeAddress: "Rua A, 10",
  } as unknown as StoreConfig;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const raiz = createRoot(host);
  act(() => {
    raiz.render(
      <PreviaDoFrete config={config} nomesLigados={[]} pendente={false} />,
    );
  });
  const texto = host.textContent ?? "";
  act(() => raiz.unmount());
  host.remove();
  return texto;
}

describe("prévia do frete: prazo da entrega local", () => {
  it("prazo 0 diz 'no mesmo dia', nunca 'chega em 0 dias'", () => {
    const texto = textoDaPrevia(0);
    expect(texto).toContain("no mesmo dia");
    expect(texto).not.toContain("0 dias");
  });

  it("controle: 1 dia e 3 dias seguem como antes", () => {
    expect(textoDaPrevia(1)).toContain("chega em 1 dia");
    expect(textoDaPrevia(1)).not.toContain("1 dias");
    expect(textoDaPrevia(3)).toContain("chega em 3 dias");
  });
});
