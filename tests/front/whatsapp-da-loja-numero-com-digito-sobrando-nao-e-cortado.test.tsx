// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WhatsAppDaLoja } from "@/components/admin/minha-loja/WhatsAppDaLoja";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Número com dígito sobrando NÃO pode virar outro número válido: se a máscara
// cortasse em 11, "34 99991-23456" passaria na validação e seria gravado em
// silêncio, e o botão de WhatsApp da loja apontaria para o número errado.
const mensagemDeExcesso = "Informe DDD + número (10 ou 11 dígitos)";

describe("WhatsApp da loja — dígito sobrando não é cortado para 11", () => {
  let raiz: Root | undefined;
  let host: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => raiz?.unmount());
    host?.remove();
    vi.useRealTimers();
  });

  function abrir(valor: string, onMudar = vi.fn()) {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    act(() => {
      raiz?.render(<WhatsAppDaLoja valor={valor} onMudar={onMudar} />);
    });
    return host.querySelector("input") as HTMLInputElement;
  }

  function colar(campo: HTMLInputElement, texto: string) {
    act(() => {
      campo.focus();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it.each([
    ["349999123456", "349999123456"],
    ["(34) 99991-23456 7", "3499991234567"],
  ])(
    "colar %s mantém o número inteiro, acusa o erro e não entrega o cortado",
    (texto, digitosEsperados) => {
      const onMudar = vi.fn();
      const campo = abrir("", onMudar);

      colar(campo, texto);

      // O campo mostra tudo o que foi colado, não os 11 primeiros dígitos.
      expect(campo.value.replace(/\D/g, "")).toBe(digitosEsperados);
      expect(campo.value).not.toBe("(34) 99991-2345");
      expect(campo.getAttribute("aria-invalid")).toBe("true");
      expect(host?.textContent).toContain(mensagemDeExcesso);

      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(onMudar).toHaveBeenCalledTimes(1);
      expect(onMudar).toHaveBeenCalledWith(digitosEsperados);
      expect(onMudar).not.toHaveBeenCalledWith("34999912345");
    },
  );

  it("digitar o 12º dígito depois de um número completo não corta nem grava o de 11", () => {
    const onMudar = vi.fn();
    const campo = abrir("34999912345", onMudar);
    expect(campo.getAttribute("aria-invalid")).not.toBe("true");

    colar(campo, "(34) 99991-2345 6");

    expect(campo.value.replace(/\D/g, "")).toBe("349999123456");
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(host?.textContent).toContain(mensagemDeExcesso);

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onMudar).toHaveBeenLastCalledWith("349999123456");
  });

  it("carrega do banco um valor com dígito sobrando sem cortar, e mostra o erro", () => {
    const campo = abrir("349999123456");
    expect(campo.value.replace(/\D/g, "")).toBe("349999123456");
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(host?.textContent).toContain(mensagemDeExcesso);
  });

  it("controle: 11 dígitos válidos são aceitos sem erro e entregues inteiros", () => {
    const onMudar = vi.fn();
    const campo = abrir("", onMudar);

    colar(campo, "34999912345");

    expect(campo.value).toBe("(34) 99991-2345");
    expect(campo.getAttribute("aria-invalid")).not.toBe("true");
    expect(host?.textContent).not.toContain(mensagemDeExcesso);

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onMudar).toHaveBeenCalledWith("34999912345");
  });
});
