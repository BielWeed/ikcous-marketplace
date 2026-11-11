// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhatsAppDaLoja } from "@/components/admin/minha-loja/WhatsAppDaLoja";
import {
  numeroParaOCampo,
  whatsappParaGravar,
} from "@/components/admin/minha-loja/contato";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mensagem = "Confira o WhatsApp: faltou um número (DDD + 9 + 8 dígitos)";

describe("Contato da loja — celular com um dígito faltando", () => {
  it.each(["3499991234", "(34) 9999-1234", "+55 34 9999-1234"])(
    "recusa gravar o celular incompleto %s",
    (numero) => {
      expect(whatsappParaGravar(numero)).toEqual({ valido: false });
    },
  );

  it("recusa também o número nacional já limpo pelo campo", () => {
    expect(whatsappParaGravar("3499991234", true)).toEqual({ valido: false });
  });

  it.each([
    ["34999912345", "5534999912345"],
    ["3432221234", "553432221234"],
    ["", null],
  ])("preserva o número válido ou opcional %s", (numero, valor) => {
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

  it.each(["3499991234", "(34) 9999-1234", "+55 34 9999-1234"])(
    "mostra no campo a mensagem de celular incompleto ao digitar %s",
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

  it.each(["34999912345", "3432221234", ""])(
    "não acusa erro no campo válido ou opcional %s",
    (numero) => {
      const campo = abrir(numero);
      expect(campo.getAttribute("aria-invalid")).not.toBe("true");
      expect(host?.textContent).not.toContain(mensagem);
    },
  );

  it("carrega o legado sem truncar e mantém o campo editável para corrigir", () => {
    const nacional = numeroParaOCampo("553499991234");
    expect(nacional).toBe("3499991234");
    const campo = abrir(nacional);
    expect(campo.value).toBe("(34) 9999-1234");
    expect(campo.disabled).toBe(false);
    expect(campo.readOnly).toBe(false);
  });
});
