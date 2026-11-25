// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), CouponInput. Dois buracos que os testes vizinhos
// deixavam passar:
//  1. o botão "Aplicar" só vale com um código de verdade: campo vazio ou só com
//     espaços deixa o botão apagado (sem isso, o toque vazio dispara a conferência
//     e a cliente vê "cupom inválido" sem ter digitado nada);
//  2. o envio do formulário NÃO deixa o navegador seguir o caminho dele (recarregar
//     a página): sem o `preventDefault`, o toque em "Aplicar" derrubava o carrinho.
// Dados inventados, sem rede e sem relógio.
import { CouponInput } from "@/components/ui/custom/CouponInput";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
});

async function render(props: Parameters<typeof CouponInput>[0]) {
  await act(async () => {
    raiz.render(<CouponInput {...props} />);
  });
}

async function digitar(texto: string) {
  const campo = hospedeiro.querySelector<HTMLInputElement>(
    "#coupon-code-input",
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const botaoAplicar = () =>
  hospedeiro.querySelector<HTMLButtonElement>('button[type="submit"]');

async function enviar(): Promise<Event> {
  const envio = new Event("submit", { bubbles: true, cancelable: true });
  await act(async () => {
    hospedeiro.querySelector("form")?.dispatchEvent(envio);
  });
  return envio;
}

describe("CouponInput: o botão Aplicar e o envio do formulário", () => {
  it("campo vazio: o botão Aplicar nasce apagado", async () => {
    await render({ onApply: vi.fn(), onRemove: vi.fn() });
    expect(botaoAplicar()?.disabled).toBe(true);
  });

  it("só espaços: o botão continua apagado; com um código, acende", async () => {
    await render({ onApply: vi.fn(), onRemove: vi.fn() });
    await digitar("   ");
    expect(botaoAplicar()?.disabled).toBe(true);
    await digitar("  PROMO10 ");
    expect(botaoAplicar()?.disabled).toBe(false);
    await digitar("");
    expect(botaoAplicar()?.disabled).toBe(true);
  });

  it("com código, mas aplicando ou travado: o botão fica apagado", async () => {
    await render({ onApply: vi.fn(), onRemove: vi.fn(), aplicando: true });
    await digitar("PROMO10");
    expect(botaoAplicar()?.disabled).toBe(true);
    await render({ onApply: vi.fn(), onRemove: vi.fn(), travado: true });
    expect(botaoAplicar()?.disabled).toBe(true);
  });

  it("o envio é cancelado (defaultPrevented) com código, vazio ou travado", async () => {
    const onApply = vi.fn();
    await render({ onApply, onRemove: vi.fn() });
    expect((await enviar()).defaultPrevented).toBe(true);
    expect(onApply).not.toHaveBeenCalled();

    await digitar("PROMO10");
    expect((await enviar()).defaultPrevented).toBe(true);
    expect(onApply).toHaveBeenCalledTimes(1);

    await render({ onApply, onRemove: vi.fn(), travado: true });
    expect((await enviar()).defaultPrevented).toBe(true);
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
