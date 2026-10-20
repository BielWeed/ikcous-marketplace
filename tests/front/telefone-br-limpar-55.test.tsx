// @vitest-environment jsdom
//
// WhatsApp colado com "+55" (ex.: "+55 34 99999-1234"): as máscaras liam o
// "55" como DDD e cortavam os últimos dígitos. Agora UMA função
// (`limparTelefoneBrasileiro`) tira o 55 do país antes de formatar, e o link
// do WhatsApp do pedido e a máscara do cliente avulso do balcão a usam.
import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import {
  ehColagemDeTelefone,
  limparTelefoneBrasileiro,
  mascaraTelefoneDoCadastro,
  mascaraWhatsappBr,
} from "@/lib/telefone-br";
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

// Simula o que o navegador faz: cada texto novo chega com o valor anterior
// do campo (a máscara decide colagem x digitação por essa diferença).
function teclarSeguido(
  mascara: (novo: string, anterior?: string) => string,
  teclas: string[],
) {
  let campo = "";
  for (const t of teclas) campo = mascara(campo + t, campo);
  return campo;
}

const RS = ["5", "5", "9", "9", "9", "9", "9", "1", "2", "3", "4"];

describe.each([
  ["checkout/busca de pedido", mascaraWhatsappBr],
  ["cadastro", mascaraTelefoneDoCadastro],
])("máscara real: %s", (_nome, mascara) => {
  it("RS tecla a tecla: (55) 99999-1234, e um 12º dígito não vira outro número", () => {
    expect(teclarSeguido(mascara, RS)).toBe("(55) 99999-1234");
    expect(teclarSeguido(mascara, [...RS, "5"])).toBe("(55) 99999-1234");
  });

  it("colar +55 34 99999-1234 vira (34) 99999-1234", () => {
    expect(mascara("+55 34 99999-1234", "")).toBe("(34) 99999-1234");
  });

  it("colar 5534999991234 sem + (ganho de 13 dígitos) vira (34) 99999-1234", () => {
    expect(mascara("5534999991234", "")).toBe("(34) 99999-1234");
  });

  it("digitar normal tecla a tecla inalterado", () => {
    expect(teclarSeguido(mascara, [..."34999991234"])).toBe("(34) 99999-1234");
  });

  it("backspace e campo vazio", () => {
    expect(mascara("(34) 99999-123", "(34) 99999-1234")).toBe("(34) 99999-123");
    expect(mascara("", "3")).toBe("");
    expect(mascara("", "")).toBe("");
  });

  it("fixo de 10 dígitos digitado e colado", () => {
    expect(mascara("(34) 3333-1234", "(34) 3333-123")).toBe("(34) 33331-234");
    expect(mascara("+55 34 3333-1234", "")).toBe("(34) 33331-234");
  });
});

describe("máscara do cadastro: estrangeiro", () => {
  it("12 dígitos sem 55 colados ficam como estavam (corte em 15)", () => {
    expect(mascaraTelefoneDoCadastro("+351912345678", "")).toBe(
      "+351912345678",
    );
  });
});

describe("ehColagemDeTelefone", () => {
  it("+ no começo ou ganho de 2+ dígitos é colagem; 1 dígito ou apagar não", () => {
    expect(ehColagemDeTelefone("+5", "")).toBe(true);
    expect(ehColagemDeTelefone("55", "")).toBe(true);
    expect(ehColagemDeTelefone("5", "")).toBe(false);
    expect(ehColagemDeTelefone("(55) 9", "(55) ")).toBe(false);
    expect(ehColagemDeTelefone("(34) 9", "(34) 99")).toBe(false);
  });
});

describe("limparTelefoneBrasileiro com colagem: false (digitação)", () => {
  it("nunca tira o 55", () => {
    expect(limparTelefoneBrasileiro("559999912345", { colagem: false })).toBe(
      "559999912345",
    );
  });
});

describe("máscara de telefone do cliente avulso (LocalBufferedInput)", () => {
  function sessao() {
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
    const mudar = (v: string) =>
      act(() => {
        setter?.call(campo, v);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const fim = () => {
      act(() => root.unmount());
      div.remove();
    };
    return { campo, mudar, fim };
  }

  it("colar +55 34 99999-1234 vira (34) 99999-1234", () => {
    const { campo, mudar, fim } = sessao();
    mudar("+55 34 99999-1234");
    expect(campo.value).toBe("(34) 99999-1234");
    fim();
  });

  it("digitar 34999991234 continua (34) 99999-1234", () => {
    const { campo, mudar, fim } = sessao();
    mudar("34999991234");
    expect(campo.value).toBe("(34) 99999-1234");
    fim();
  });

  it("RS tecla a tecla com 12º dígito continua (55) 99999-1234", () => {
    const { campo, mudar, fim } = sessao();
    for (const t of [...RS, "5"]) mudar(campo.value + t);
    expect(campo.value).toBe("(55) 99999-1234");
    fim();
  });
});
