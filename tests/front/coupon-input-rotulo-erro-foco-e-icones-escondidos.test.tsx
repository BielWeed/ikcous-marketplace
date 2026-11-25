// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território ui/custom: o campo de cupom do
// checkout tinha o texto de erro e o botão travado cobertos, mas estes pontos
// de acessibilidade e de foco podiam sumir sem nenhum teste reclamar:
//  - o rótulo "Tem um código de cupom?" ligado ao campo (sem ele o leitor de
//    tela diz só "caixa de edição");
//  - o campo se declarar inválido e apontar a mensagem quando o cupom é
//    recusado;
//  - os ícones decorativos escondidos do leitor de tela (senão ele lê
//    "10% OFF" duas vezes: no selo e no texto);
//  - a borda que mostra onde está o foco, e que o erro vermelho vence o foco.
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
});

async function render(props: Partial<Parameters<typeof CouponInput>[0]> = {}) {
  await act(async () => {
    raiz.render(
      <CouponInput onApply={vi.fn()} onRemove={vi.fn()} {...props} />,
    );
  });
}

function campo(): HTMLInputElement {
  return hospedeiro.querySelector("#coupon-code-input") as HTMLInputElement;
}

/** A moldura que muda de cor: o pai direto do campo. */
function moldura(): HTMLElement {
  return campo().parentElement as HTMLElement;
}

describe("CouponInput — rótulo, erro e ícones para o leitor de tela", () => {
  it("o rótulo está ligado ao campo (clicar no rótulo ou o leitor de tela chegam nele)", async () => {
    await render();
    const rotulo = hospedeiro.querySelector("label") as HTMLLabelElement;
    expect(rotulo.htmlFor).toBe("coupon-code-input");
    expect(campo().labels?.[0]).toBe(rotulo);
    expect(rotulo.textContent).toBe("Tem um código de cupom?");
  });

  it("sem erro o campo não se declara inválido nem aponta mensagem", async () => {
    await render();
    expect(campo().hasAttribute("aria-invalid")).toBe(false);
    expect(campo().hasAttribute("aria-describedby")).toBe(false);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("com erro: o campo é inválido, aponta a mensagem e a mensagem é um alerta", async () => {
    await render({ error: "Cupom expirado" });
    expect(campo().getAttribute("aria-invalid")).toBe("true");
    const id = campo().getAttribute("aria-describedby");
    expect(id).toBe("erro-cupom");
    const mensagem = hospedeiro.querySelector(`#${id}`) as HTMLElement;
    expect(mensagem.getAttribute("role")).toBe("alert");
    expect(mensagem.textContent).toBe("Cupom expirado");
  });

  it("o ícone da etiqueta e o X do erro são decorativos (escondidos do leitor de tela)", async () => {
    await render();
    const semErro = hospedeiro.querySelectorAll("svg");
    expect(semErro.length).toBe(1);
    expect(semErro[0]?.getAttribute("aria-hidden")).toBe("true");

    await render({ error: "Cupom esgotado" });
    const comErro = Array.from(hospedeiro.querySelectorAll("svg"));
    expect(comErro.length).toBe(2);
    for (const icone of comErro) {
      expect(icone.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("cupom aplicado: o selo de desconto e a bolinha de 'escolhida' são decorativos", async () => {
    await render({
      appliedCoupon: { code: "VERAO10", discount: 12 },
      destaque: "10%",
    });
    const cartao = hospedeiro.querySelector(
      '[data-testid="cupom-aplicado"]',
    ) as HTMLElement;
    const selo = cartao.firstElementChild as HTMLElement;
    expect(selo.textContent).toContain("10%");
    expect(selo.getAttribute("aria-hidden")).toBe("true");
    const bolinha = hospedeiro.querySelector(
      '[data-testid="selo-de-escolhida"]',
    ) as HTMLElement;
    expect(bolinha.getAttribute("aria-hidden")).toBe("true");
    // o que o leitor de tela de fato lê: o código e a economia.
    expect(cartao.textContent).toContain("VERAO10");
  });
});

describe("CouponInput — a borda mostra onde está o foco", () => {
  it("em repouso: borda cinza, sem destaque de foco", async () => {
    await render();
    expect(moldura().classList.contains("border-zinc-400")).toBe(true);
    expect(moldura().classList.contains("border-zinc-900")).toBe(false);
    expect(moldura().classList.contains("border-red-600")).toBe(false);
  });

  it("ao focar o campo a borda escurece; ao sair, volta ao cinza", async () => {
    await render();
    await act(async () => {
      campo().focus();
    });
    expect(moldura().classList.contains("border-zinc-900")).toBe(true);
    expect(moldura().classList.contains("border-zinc-400")).toBe(false);

    await act(async () => {
      campo().blur();
    });
    expect(moldura().classList.contains("border-zinc-400")).toBe(true);
    expect(moldura().classList.contains("border-zinc-900")).toBe(false);
  });

  it("com erro a borda é vermelha, focada ou não: o erro vence o foco", async () => {
    await render({ error: "Cupom inválido" });
    expect(moldura().classList.contains("border-red-600")).toBe(true);
    await act(async () => {
      campo().focus();
    });
    expect(moldura().classList.contains("border-red-600")).toBe(true);
    expect(moldura().classList.contains("border-zinc-900")).toBe(false);
  });
});
