// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhatsAppDaLoja } from "@/components/admin/minha-loja/WhatsAppDaLoja";
import { whatsappParaGravar } from "@/components/admin/minha-loja/contato";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mensagem =
  "Confira o WhatsApp: celular precisa começar com 9 depois do DDD.";

describe("Contato da loja — celular sem o 9 depois do DDD", () => {
  it.each(["11323456789", "5511323456789", "(11) 3234-56789"])(
    "recusa gravar o celular impossível %s",
    (numero) => {
      expect(whatsappParaGravar(numero)).toEqual({ valido: false });
    },
  );

  it("recusa também o número nacional já limpo pelo campo", () => {
    expect(whatsappParaGravar("11323456789", true)).toEqual({ valido: false });
  });

  it.each([
    ["11987654321", "5511987654321"],
    ["5511987654321", "5511987654321"],
    ["1132345678", "551132345678"],
  ])("preserva o celular ou fixo válido %s", (numero, valor) => {
    expect(whatsappParaGravar(numero)).toEqual({ valido: true, valor });
  });

  let raiz: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => raiz?.unmount());
    host?.remove();
  });

  function abrir(valor: string) {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    act(() => {
      raiz?.render(<WhatsAppDaLoja valor={valor} onMudar={vi.fn()} />);
    });
    return host.querySelector("input") as HTMLInputElement;
  }

  it.each(["11323456789", "5511323456789", "(11) 3234-56789"])(
    "avisa no campo ao digitar %s",
    (numero) => {
      const campo = abrir("");
      act(() => {
        campo.focus();
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(campo, numero);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(campo.getAttribute("aria-invalid")).toBe("true");
      expect(host?.textContent).toContain(mensagem);
    },
  );

  it.each(["11987654321", "1132345678", ""])(
    "não acusa erro no número válido ou opcional %s",
    (numero) => {
      const campo = abrir(numero);
      expect(campo.getAttribute("aria-invalid")).not.toBe("true");
      expect(host?.textContent).not.toContain(mensagem);
    },
  );
});
