// @vitest-environment jsdom
//
// Prévia do painel: loja que ainda não gravou o prazo da entrega na cidade
// (`localDeliveryDays` ausente) mostra o padrão da loja, "chega em 1 dia" —
// o mesmo que a cliente lê. O teste vizinho (prazo zero diz "mesmo dia")
// declara o parâmetro `undefined` mas nunca o exercita, então trocar o padrão
// (1 → 2, 1 → 0) passava sem ninguém ver.
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

describe("prévia do frete: prazo da entrega local ainda não gravado", () => {
  it("sem prazo gravado, diz o padrão 'chega em 1 dia' (singular)", () => {
    const texto = textoDaPrevia(undefined);
    expect(texto).toContain("chega em 1 dia");
    expect(texto).not.toContain("1 dias");
    expect(texto).not.toContain("no mesmo dia");
  });
});
