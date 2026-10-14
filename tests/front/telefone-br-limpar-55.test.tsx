// @vitest-environment jsdom
//
// WhatsApp colado com "+55" (ex.: "+55 34 99999-1234"): as máscaras liam o
// "55" como DDD e cortavam os últimos dígitos. Agora UMA função
// (`limparTelefoneBrasileiro`) tira o 55 do país antes de formatar, e o link
// do WhatsApp do pedido e a máscara do cliente avulso do balcão a usam.
import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { limparTelefoneBrasileiro } from "@/lib/telefone-br";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

describe("limparTelefoneBrasileiro", () => {
  it("colado com +55 e 11 dígitos nacionais: sobra DDD + número", () => {
    expect(limparTelefoneBrasileiro("+55 34 99999-1234")).toBe("34999991234");
    expect(limparTelefoneBrasileiro("5534999991234")).toBe("34999991234");
  });

  it("colado com +55 e 10 dígitos nacionais (fixo): sobra DDD + número", () => {
    expect(limparTelefoneBrasileiro("+55 (34) 3333-1234")).toBe("3433331234");
  });

  it("digitado normal fica inalterado", () => {
    expect(limparTelefoneBrasileiro("34999991234")).toBe("34999991234");
    expect(limparTelefoneBrasileiro("(34) 99999-1234")).toBe("34999991234");
    expect(limparTelefoneBrasileiro("3")).toBe("3");
    expect(limparTelefoneBrasileiro("")).toBe("");
  });

  it("DDD 55 de verdade (11 dígitos) não perde o DDD", () => {
    expect(limparTelefoneBrasileiro("55999991234")).toBe("55999991234");
  });

  it("12 dígitos que não começam por 55: inalterado (estrangeiro)", () => {
    expect(limparTelefoneBrasileiro("+351912345678")).toBe("351912345678");
    expect(limparTelefoneBrasileiro("123456789012")).toBe("123456789012");
  });
});

describe("linkWhatsappDoCliente com +55", () => {
  it("número gravado com 55 dá o link certo, sem 55 duplicado", () => {
    expect(linkWhatsappDoCliente("+55 34 99999-1234")).toBe(
      "https://wa.me/5534999991234",
    );
    expect(linkWhatsappDoCliente("34999991234")).toBe(
      "https://wa.me/5534999991234",
    );
  });

  it("12 dígitos que não são 55: passa como está", () => {
    expect(linkWhatsappDoCliente("+351912345678")).toBe(
      "https://wa.me/351912345678",
    );
  });
});

describe("máscara de telefone do cliente avulso (LocalBufferedInput)", () => {
  function digitar(valor: string) {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    act(() => {
      root.render(
        <LocalBufferedInput mask="phone" value="" onFlush={() => {}} />,
      );
    });
    const campo = div.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const resultado = campo.value;
    act(() => root.unmount());
    div.remove();
    return resultado;
  }

  it("colar +55 34 99999-1234 vira (34) 99999-1234", () => {
    expect(digitar("+55 34 99999-1234")).toBe("(34) 99999-1234");
  });

  it("digitar 34999991234 continua (34) 99999-1234", () => {
    expect(digitar("34999991234")).toBe("(34) 99999-1234");
  });
});
