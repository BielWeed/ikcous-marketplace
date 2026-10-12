// @vitest-environment jsdom
//
// DEVICE ID DO COMPRADOR (03/10/2026). O antifraude do Mercado Pago recusou um
// cartão real (`high_risk`) porque não recebia o Device ID. Quem o cria é o
// `security.js` do próprio MP (`window.MP_DEVICE_SESSION_ID`); aqui se prova o
// que decide o dinheiro: o valor só passa se for do formato fechado, o script
// entra UMA vez e só quando o cartão vai ser montado, e NADA disso pode
// derrubar o pagamento.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Modulo = typeof import("@/components/checkout/device-id-mercado-pago");

// O loader guarda estado em módulo (como o do SDK): cada teste importa uma
// cópia nova para não herdar o "já carreguei" do anterior.
async function modulo(): Promise<Modulo> {
  vi.resetModules();
  return await import("@/components/checkout/device-id-mercado-pago");
}

function tags(): HTMLScriptElement[] {
  return Array.from(
    document.querySelectorAll<HTMLScriptElement>("script[data-mp-device-id]"),
  );
}

const ID_REAL = "armor.8c1f0e2b9d7a4c35b6e1f0a9d8c7b6a5.XyZ123abc.9f8e7d6c5b4a";

beforeEach(() => {
  for (const tag of tags()) tag.remove();
  Reflect.deleteProperty(globalThis, "MP_DEVICE_SESSION_ID");
});

afterEach(() => {
  for (const tag of tags()) tag.remove();
  Reflect.deleteProperty(globalThis, "MP_DEVICE_SESSION_ID");
  vi.restoreAllMocks();
});

describe("deviceIdValido — formato fechado (o mesmo da edge)", () => {
  it("aceita letras, dígitos, ponto, hífen e sublinhado, de 1 a 512", async () => {
    const { deviceIdValido } = await modulo();
    for (const bom of [ID_REAL, "a", "abc-DEF_123.xyz", "x".repeat(512)]) {
      expect(deviceIdValido(bom)).toBe(true);
    }
  });

  it("recusa não-string, vazio, grande demais e qualquer caractere fora do formato", async () => {
    const { deviceIdValido } = await modulo();
    const ruins: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      "",
      "x".repeat(513),
      " abc",
      "abc def",
      "abc\r\nX-Evil: 1",
      "abc:def",
      "abç",
      "<script>",
    ];
    for (const ruim of ruins) {
      expect(deviceIdValido(ruim)).toBe(false);
    }
  });
});

describe("lerDeviceIdDoMercadoPago — lê o global no instante do envio", () => {
  it("devolve o valor quando o security.js já o criou", async () => {
    const { lerDeviceIdDoMercadoPago } = await modulo();
    Reflect.set(globalThis, "MP_DEVICE_SESSION_ID", ID_REAL);
    expect(lerDeviceIdDoMercadoPago()).toBe(ID_REAL);
  });

  it("devolve null quando a coleta ainda não terminou (ausente) — o pagamento segue sem", async () => {
    const { lerDeviceIdDoMercadoPago } = await modulo();
    expect(lerDeviceIdDoMercadoPago()).toBeNull();
  });

  it("devolve null para valor imprestável (nunca repassa o que não passa no formato)", async () => {
    const { lerDeviceIdDoMercadoPago } = await modulo();
    for (const ruim of ["", "com espaço", "x".repeat(513), 42, {}, null]) {
      Reflect.set(globalThis, "MP_DEVICE_SESSION_ID", ruim);
      expect(lerDeviceIdDoMercadoPago()).toBeNull();
    }
  });
});

describe("carregarDeviceIdMercadoPago — o security.js entra uma vez, com view=checkout", () => {
  it("anexa UM script do security.js com view=checkout, assíncrono", async () => {
    const { carregarDeviceIdMercadoPago, SECURITY_JS_URL } = await modulo();
    expect(SECURITY_JS_URL).toBe("https://www.mercadopago.com/v2/security.js");
    expect(tags()).toHaveLength(0);

    carregarDeviceIdMercadoPago();

    expect(tags()).toHaveLength(1);
    const [tag] = tags();
    expect(tag.getAttribute("src")).toBe(SECURITY_JS_URL);
    expect(tag.getAttribute("view")).toBe("checkout");
    expect(tag.async).toBe(true);
  });

  it("chamado de novo (StrictMode, outra montagem, Tentar outro cartão) NÃO duplica o script", async () => {
    const { carregarDeviceIdMercadoPago } = await modulo();
    carregarDeviceIdMercadoPago();
    carregarDeviceIdMercadoPago();
    carregarDeviceIdMercadoPago();
    expect(tags()).toHaveLength(1);
  });

  it("depois de carregar, continua sem duplicar", async () => {
    const { carregarDeviceIdMercadoPago } = await modulo();
    carregarDeviceIdMercadoPago();
    tags()[0].dispatchEvent(new Event("load"));
    carregarDeviceIdMercadoPago();
    expect(tags()).toHaveLength(1);
  });

  it("não duplica nem se já houver a tag na página (módulo recarregado, HMR)", async () => {
    const primeiro = await modulo();
    primeiro.carregarDeviceIdMercadoPago();
    const segundo = await modulo();
    segundo.carregarDeviceIdMercadoPago();
    expect(tags()).toHaveLength(1);
  });

  it("script que FALHA (bloqueio de rede/extensão) não lança, remove a tag morta e deixa uma tentativa futura recomeçar", async () => {
    const { carregarDeviceIdMercadoPago } = await modulo();
    carregarDeviceIdMercadoPago();
    expect(() => tags()[0].dispatchEvent(new Event("error"))).not.toThrow();
    expect(tags()).toHaveLength(0);

    carregarDeviceIdMercadoPago();
    expect(tags()).toHaveLength(1);
  });

  it("DOM que recusa o script (appendChild lança) não derruba quem chamou — e a próxima chamada tenta de novo", async () => {
    const { carregarDeviceIdMercadoPago } = await modulo();
    const espiao = vi
      .spyOn(document.head, "appendChild")
      .mockImplementationOnce(() => {
        throw new Error("DOM recusou");
      });

    expect(() => carregarDeviceIdMercadoPago()).not.toThrow();
    expect(tags()).toHaveLength(0);

    espiao.mockRestore();
    carregarDeviceIdMercadoPago();
    expect(tags()).toHaveLength(1);
  });

  it("NÃO carrega nada só por importar o módulo (o boot do app não paga por isso)", async () => {
    await modulo();
    expect(tags()).toHaveLength(0);
  });
});
