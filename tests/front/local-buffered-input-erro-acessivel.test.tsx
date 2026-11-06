// @vitest-environment jsdom
//
// Defeito (05/11/2026): o erro de preenchimento dos campos do painel (usado com
// `validate=` no WhatsApp da loja, na política de devolução e nos banners) só
// aparecia para quem enxerga: borda vermelha e um <p> comum, sem `aria-invalid`,
// sem `aria-describedby` e sem região viva. Leitor de tela não avisava que o
// campo estava errado nem o motivo.
//
// A regra: com erro, o campo vira `aria-invalid="true"`, aponta para a mensagem
// por `aria-describedby` e a mensagem é `role="alert"`. Sem erro, nada disso
// aparece. Um `aria-describedby` que o chamador já passou é preservado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MENSAGEM = "Informe só números";
const validarNumero = (v: string) => (/^\d*$/.test(v) ? null : MENSAGEM);

function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto =
    el instanceof globalThis.HTMLTextAreaElement
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("LocalBufferedInput / LocalBufferedTextarea — erro acessível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  function montar(el: React.ReactElement) {
    act(() => {
      raiz.render(el);
    });
  }

  const alerta = () => hospedeiro.querySelector('[role="alert"]');

  const casos = [
    {
      nome: "campo de uma linha",
      tag: "input",
      el: (extra: object = {}) => (
        <LocalBufferedInput
          value="12"
          onFlush={() => {}}
          validate={validarNumero}
          {...extra}
        />
      ),
    },
    {
      nome: "campo de uma linha (shadcn)",
      tag: "input",
      el: (extra: object = {}) => (
        <LocalBufferedInput
          value="12"
          useShadcn
          onFlush={() => {}}
          validate={validarNumero}
          {...extra}
        />
      ),
    },
    {
      nome: "texto grande",
      tag: "textarea",
      el: (extra: object = {}) => (
        <LocalBufferedTextarea
          value="12"
          onFlush={() => {}}
          validate={validarNumero}
          {...extra}
        />
      ),
    },
    {
      nome: "texto grande (shadcn)",
      tag: "textarea",
      el: (extra: object = {}) => (
        <LocalBufferedTextarea
          value="12"
          useShadcn
          onFlush={() => {}}
          validate={validarNumero}
          {...extra}
        />
      ),
    },
  ];

  for (const caso of casos) {
    describe(caso.nome, () => {
      const campo = () =>
        hospedeiro.querySelector(caso.tag) as
          | HTMLInputElement
          | HTMLTextAreaElement;

      it("sem erro: sem aria-invalid, sem aria-describedby e sem alerta", () => {
        montar(caso.el());
        expect(campo().hasAttribute("aria-invalid")).toBe(false);
        expect(campo().hasAttribute("aria-describedby")).toBe(false);
        expect(alerta()).toBeNull();
      });

      it("com erro: aria-invalid, aria-describedby apontando para a mensagem e role=alert", () => {
        montar(caso.el());
        act(() => {
          digitar(campo(), "abc");
        });
        expect(campo().getAttribute("aria-invalid")).toBe("true");
        const mensagem = alerta();
        expect(mensagem?.textContent).toContain(MENSAGEM);
        expect(mensagem?.id).toBeTruthy();
        expect(campo().getAttribute("aria-describedby")).toBe(mensagem?.id);
      });

      it("corrigido o erro, os atributos somem", () => {
        montar(caso.el());
        act(() => {
          digitar(campo(), "abc");
        });
        act(() => {
          digitar(campo(), "123");
        });
        expect(campo().hasAttribute("aria-invalid")).toBe(false);
        expect(campo().hasAttribute("aria-describedby")).toBe(false);
        expect(alerta()).toBeNull();
      });

      it("aria-describedby do chamador é mantido sem erro e combinado com erro", () => {
        montar(caso.el({ "aria-describedby": "dica-do-campo" }));
        expect(campo().getAttribute("aria-describedby")).toBe("dica-do-campo");
        act(() => {
          digitar(campo(), "abc");
        });
        const ids = (campo().getAttribute("aria-describedby") ?? "").split(" ");
        expect(ids).toContain("dica-do-campo");
        expect(ids).toContain(alerta()?.id);
      });
    });
  }
});
