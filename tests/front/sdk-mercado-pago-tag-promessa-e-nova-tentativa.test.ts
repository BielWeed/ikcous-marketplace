// @vitest-environment jsdom
//
// O carregador do SDK do Mercado Pago (`src/components/checkout/sdk-mercado-pago.ts`):
// a tag que ele anexa (endereço, assíncrona, marcada), a promessa que é UMA só
// por sessão (StrictMode monta duas vezes), a tag que já está na página, e a
// falha que limpa tudo para a próxima tentativa recomeçar. Os testes de tela
// trocam o carregador por um dublê; aqui ele roda de verdade.
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

describe("carregarSdkMercadoPago — a tag", () => {
  it("anexa UM script assíncrono, do endereço do SDK v2, marcado como do SDK, no head", () => {
    return modulo().then(({ carregarSdkMercadoPago }) => {
      void carregarSdkMercadoPago();
      const achadas = tags();
      expect(achadas).toHaveLength(1);
      const tag = achadas[0] as HTMLScriptElement;
      expect(tag.src).toBe("https://sdk.mercadopago.com/js/v2");
      expect(tag.async).toBe(true);
      expect(tag.dataset.mpSdk).toBe("1");
      expect(tag.parentElement).toBe(document.head);
    });
  });

  it("chamar de novo antes de terminar devolve a MESMA promessa e não duplica a tag", async () => {
    const { carregarSdkMercadoPago } = await modulo();
    const a = carregarSdkMercadoPago();
    const b = carregarSdkMercadoPago();
    expect(b).toBe(a);
    expect(tags()).toHaveLength(1);
  });

  it("resolve quando o script carrega e continua resolvida nas chamadas seguintes", async () => {
    const { carregarSdkMercadoPago } = await modulo();
    const promessa = carregarSdkMercadoPago();
    (tags()[0] as HTMLScriptElement).dispatchEvent(new Event("load"));
    await expect(promessa).resolves.toBeUndefined();
    await expect(carregarSdkMercadoPago()).resolves.toBeUndefined();
    expect(tags()).toHaveLength(1);
  });
});

describe("carregarSdkMercadoPago — tag que já está na página", () => {
  it("adota a tag existente: não cria outra e resolve quando ELA carrega", async () => {
    const existente = document.createElement("script");
    existente.dataset.mpSdk = "1";
    document.head.appendChild(existente);
    const { carregarSdkMercadoPago } = await modulo();
    const promessa = carregarSdkMercadoPago();
    expect(tags()).toEqual([existente]);
    // adotar não mexe no endereço da tag que já estava lá
    expect(existente.getAttribute("src")).toBeNull();
    existente.dispatchEvent(new Event("load"));
    await expect(promessa).resolves.toBeUndefined();
  });
});

describe("carregarSdkMercadoPago — falha e nova tentativa", () => {
  it("script que falha rejeita com a frase da cliente, REMOVE a tag morta e libera nova tentativa", async () => {
    const { carregarSdkMercadoPago } = await modulo();
    const primeira = carregarSdkMercadoPago();
    const morta = tags()[0] as HTMLScriptElement;
    morta.dispatchEvent(new Event("error"));
    await expect(primeira).rejects.toThrow(
      "Não foi possível carregar o pagamento.",
    );
    expect(morta.isConnected).toBe(false);
    expect(tags()).toHaveLength(0);

    // A nova tentativa recomeça do zero: tag nova, promessa nova.
    const segunda = carregarSdkMercadoPago();
    expect(segunda).not.toBe(primeira);
    const nova = tags();
    expect(nova).toHaveLength(1);
    expect(nova[0]).not.toBe(morta);
    expect((nova[0] as HTMLScriptElement).src).toBe(
      "https://sdk.mercadopago.com/js/v2",
    );
    (nova[0] as HTMLScriptElement).dispatchEvent(new Event("load"));
    await expect(segunda).resolves.toBeUndefined();
  });

  it("falha de uma tag adotada também a remove e rejeita", async () => {
    const existente = document.createElement("script");
    existente.dataset.mpSdk = "1";
    document.head.appendChild(existente);
    const { carregarSdkMercadoPago } = await modulo();
    const promessa = carregarSdkMercadoPago();
    existente.dispatchEvent(new Event("error"));
    await expect(promessa).rejects.toThrow();
    expect(existente.isConnected).toBe(false);
  });
});
