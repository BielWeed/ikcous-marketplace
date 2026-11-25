// @vitest-environment jsdom
//
// O carregador do SDK do Mercado Pago ao ADOTAR uma tag que já está na página
// (`src/components/checkout/sdk-mercado-pago.ts`). Achado por mutação: trocar
// `if (!existente) document.head.appendChild(tag)` por um `appendChild` sempre
// não derrubava teste nenhum, porque o teste antigo põe a tag já no `head` — e
// reanexar um nó o MOVE. Quem adota não pode mexer na página: a tag continua
// onde estava (aqui, no `body`), sem endereço novo e sem tag irmã.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Modulo = typeof import("@/components/checkout/sdk-mercado-pago");

// A promessa fica guardada em módulo: cada teste importa uma cópia nova.
async function modulo(): Promise<Modulo> {
  vi.resetModules();
  return await import("@/components/checkout/sdk-mercado-pago");
}

function tags(): HTMLScriptElement[] {
  return Array.from(
    document.querySelectorAll<HTMLScriptElement>("script[data-mp-sdk]"),
  );
}

beforeEach(() => {
  for (const tag of tags()) tag.remove();
});

afterEach(() => {
  for (const tag of tags()) tag.remove();
});

describe("carregarSdkMercadoPago — tag adotada não é movida", () => {
  it("tag que está no body continua no body e resolve quando ELA carrega", async () => {
    const existente = document.createElement("script");
    existente.dataset.mpSdk = "1";
    document.body.appendChild(existente);
    const { carregarSdkMercadoPago } = await modulo();

    const promessa = carregarSdkMercadoPago();

    expect(tags()).toEqual([existente]);
    expect(existente.parentElement).toBe(document.body);
    expect(document.head.querySelector("script[data-mp-sdk]")).toBeNull();

    existente.dispatchEvent(new Event("load"));
    await expect(promessa).resolves.toBeUndefined();
    expect(existente.parentElement).toBe(document.body);
  });

  it("controle: sem tag na página, a nova entra no head", async () => {
    const { carregarSdkMercadoPago } = await modulo();
    void carregarSdkMercadoPago();
    expect(tags()).toHaveLength(1);
    expect(tags()[0]?.parentElement).toBe(document.head);
  });
});
