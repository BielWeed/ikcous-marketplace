// @vitest-environment jsdom
//
// PASSO A3 do redesenho da tela "Finalizar pedido" (22/10/2026, aprovado pelo
// dono): "Cupons" com cartões TOCÁVEIS (o cartão inteiro aplica o cupom), o
// selecionado com borda forte + bolinha escura com check, o desconto em verde
// só no TEXTO, "vence hoje/amanhã" em âmbar só no TEXTO, e o campo de digitar
// o código atrás do link "Tenho um código de cupom". Só apresentação: as
// chamadas (`onApply`, `onRemove`) e a validação são as de sempre.
import { CuponsDoCheckout } from "@/components/checkout/CuponsDoCheckout";
import type { CupomDisponivel } from "@/lib/cupons-do-checkout";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const amanha = () => new Date(Date.now() + 24 * 3600_000).toISOString();

const cupom = (extra: Partial<CupomDisponivel>): CupomDisponivel => ({
  codigo: "VITRINE10",
  tipo: "percentage",
  valor: 10,
  minimo: 0,
  validoAte: null,
  exclusivo: false,
  aplica: true,
  falta: 0,
  desconto: 10,
  ...extra,
});

const LISTA: CupomDisponivel[] = [
  cupom({
    codigo: "VIP15",
    tipo: "fixed",
    valor: 15,
    desconto: 15,
    exclusivo: true,
    validoAte: amanha(),
  }),
  cupom({ codigo: "VITRINE10" }),
  cupom({
    codigo: "GRANDE30",
    tipo: "fixed",
    valor: 30,
    minimo: 150,
    aplica: false,
    desconto: 0,
    falta: 50,
  }),
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

function montar(props: Partial<Parameters<typeof CuponsDoCheckout>[0]> = {}) {
  const onApply = vi.fn();
  const onRemove = vi.fn();
  act(() => {
    raiz.render(
      <CuponsDoCheckout
        cupons={LISTA}
        situacao="pronto"
        onTentarDeNovo={vi.fn()}
        appliedCoupon={null}
        couponError=""
        aplicando={null}
        onApply={onApply}
        onRemove={onRemove}
        {...props}
      />,
    );
  });
  return { onApply, onRemove };
}

const botao = (rotulo: string) =>
  [...hospedeiro.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === rotulo || b.textContent === rotulo,
  ) as HTMLButtonElement | undefined;
const cartoes = () => [
  ...hospedeiro.querySelectorAll('ul[aria-label="Cupons disponíveis"] > li'),
];
const link = () =>
  [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Tenho um código de cupom"),
  ) as HTMLButtonElement;
const campo = () => document.getElementById("campo-de-cupom") as HTMLElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("CuponsDoCheckout — PASSO A3: cartões tocáveis e código atrás de um link", () => {
  it("o CARTÃO INTEIRO é o botão de aplicar: nome acessível 'Aplicar o cupom X', alvo de 44px, bolinha vazia de seleção", () => {
    const { onApply } = montar();
    const primeiro = cartoes()[0];
    const alvo = primeiro.querySelector("button");
    expect(alvo?.getAttribute("aria-label")).toBe("Aplicar o cupom VIP15");
    expect(alvo?.className).toContain("min-h-11");
    // O botão carrega o conteúdo do cartão (descrição, código, economia).
    expect(alvo?.textContent).toContain("R$ 15,00 OFF em qualquer compra");
    expect(alvo?.textContent).toContain("VIP15");
    expect(alvo?.textContent).toContain("Você economiza R$ 15,00");
    expect(alvo?.querySelector('[data-testid="bolinha-vazia"]')).not.toBeNull();
    // O leitor de tela ouve também o que o cartão oferece.
    const descreve = alvo?.getAttribute("aria-describedby");
    expect(descreve).toBeTruthy();
    expect(document.getElementById(descreve as string)?.textContent).toContain(
      "R$ 15,00 OFF em qualquer compra",
    );
    act(() => alvo?.click());
    expect(onApply).toHaveBeenCalledWith("VIP15");
  });

  it("cartão com mínimo não atingido não é tocável: só 'faltam R$ X' e a barra de progresso", () => {
    montar();
    const grande = cartoes()[2];
    expect(grande.querySelector("button")).toBeNull();
    expect(grande.textContent).toContain(
      "Faltam R$ 50,00 em produtos para usar",
    );
    expect(
      grande
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("67");
  });

  it("verde só no TEXTO do desconto e âmbar só no TEXTO da validade — cartão, canhoto e fundos neutros", () => {
    montar();
    const primeiro = cartoes()[0];
    const economia = [...primeiro.querySelectorAll("span, p")].find((e) =>
      e.textContent?.startsWith("Você economiza"),
    );
    expect(economia?.className).toContain("text-emerald-700");
    const vence = [...primeiro.querySelectorAll("span")].find(
      (e) => e.textContent === "Vence amanhã",
    );
    expect(vence?.className).toContain("text-amber-800");
    // Nada colorido de FUNDO ou de BORDA no cartão (o texto é quem colore).
    for (const li of cartoes()) {
      expect(li.innerHTML).not.toMatch(
        /(?:bg|border|ring)-(?:emerald|green|amber|yellow|primary)/,
      );
    }
    // E a seção inteira não usa a cor da marca em lugar nenhum.
    expect(hospedeiro.innerHTML).not.toContain("primary");
  });

  it("o chip 'Melhor opção' e o de 'Exclusivo para você' seguem na tela, em cinza neutro", () => {
    montar();
    const primeiro = cartoes()[0];
    expect(primeiro.textContent).toContain("Melhor opção");
    expect(primeiro.textContent).toContain("Exclusivo para você");
    // O chip é o span MAIS INTERNO que carrega o texto.
    const chip = [...primeiro.querySelectorAll("span")]
      .filter((e) => e.textContent?.includes("Melhor opção"))
      .pop();
    expect(chip?.className).toContain("bg-zinc-100");
  });

  it("com um cupom em validação: o cartão certo diz 'Aplicando…' e TODOS travam", () => {
    montar({ aplicando: "VIP15" });
    const vip = botao("Aplicar o cupom VIP15");
    expect(vip?.textContent).toContain("Aplicando…");
    expect(vip?.disabled).toBe(true);
    expect(botao("Aplicar o cupom VITRINE10")?.disabled).toBe(true);
  });

  it("aplicado: vira o cartão SELECIONADO (borda forte + bolinha escura com check), com 'Remover' e sem repetir na lista", () => {
    const { onRemove } = montar({
      appliedCoupon: { code: "VIP15", discount: 15 },
    });
    const selecionado = hospedeiro.querySelector(
      '[data-testid="cupom-aplicado"]',
    ) as HTMLElement;
    expect(selecionado).not.toBeNull();
    expect(selecionado.className).toContain("border-2");
    expect(selecionado.className).toContain("border-zinc-900");
    const bolinha = selecionado.querySelector(
      '[data-testid="selo-de-escolhida"]',
    ) as HTMLElement;
    expect(bolinha.className).toContain("bg-zinc-900");
    expect(bolinha.querySelector("svg")).not.toBeNull();
    expect(selecionado.textContent).toContain("VIP15 aplicado");
    expect(selecionado.textContent).toContain("Você economiza R$ 15,00");
    // O tamanho do desconto aparece no canhoto, como nos outros cartões.
    expect(selecionado.textContent).toContain("R$ 15");
    expect(cartoes().some((c) => c.textContent?.includes("VIP15"))).toBe(false);

    const remover = botao("Remover cupom");
    expect(remover?.className).toContain("min-h-11");
    act(() => remover?.click());
    expect(onRemove).toHaveBeenCalled();
  });

  it("aplicado por código secreto (fora da lista): mesmo cartão selecionado, sem canhoto inventado", () => {
    montar({ appliedCoupon: { code: "SECRETO5", discount: 5 } });
    const selecionado = hospedeiro.querySelector(
      '[data-testid="cupom-aplicado"]',
    ) as HTMLElement;
    expect(selecionado.textContent).toContain("SECRETO5 aplicado");
    expect(selecionado.textContent).not.toContain("OFF");
    expect(
      selecionado.querySelector('[data-testid="selo-de-escolhida"]'),
    ).not.toBeNull();
  });

  it("'Tenho um código de cupom': link com aria-expanded/aria-controls; o campo existente nasce escondido e o toque o revela", () => {
    const { onApply } = montar();
    const gatilho = link();
    expect(gatilho.tagName).toBe("BUTTON");
    expect(gatilho.className).toContain("min-h-11");
    expect(gatilho.getAttribute("aria-expanded")).toBe("false");
    expect(gatilho.getAttribute("aria-controls")).toBe("campo-de-cupom");
    // O campo de SEMPRE (mesmo id) segue montado, só escondido.
    expect(campo().hidden).toBe(true);
    expect(campo().querySelector("#coupon-code-input")).not.toBeNull();

    act(() => gatilho.click());
    expect(link().getAttribute("aria-expanded")).toBe("true");
    expect(campo().hidden).toBe(false);
    // O foco vai para o campo, para a pessoa já poder digitar.
    expect(document.activeElement?.id).toBe("coupon-code-input");

    // Mesma chamada de sempre: o código sai em maiúsculas e sem espaços.
    const input = document.getElementById(
      "coupon-code-input",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(input, "  savy10 ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      campo()
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(onApply).toHaveBeenCalledWith("SAVY10");

    // Tocar de novo recolhe.
    act(() => link().click());
    expect(link().getAttribute("aria-expanded")).toBe("false");
    expect(campo().hidden).toBe(true);
  });

  it("recusa do código: o campo se abre sozinho com a mensagem (o erro nunca fica escondido)", () => {
    montar({ couponError: "Cupom inválido ou expirado." });
    expect(link().getAttribute("aria-expanded")).toBe("true");
    expect(campo().hidden).toBe(false);
    expect(campo().querySelector('[role="alert"]')?.textContent).toContain(
      "Cupom inválido ou expirado.",
    );
  });

  it("com cupom aplicado o link e o campo somem (como o campo sumia antes)", () => {
    montar({ appliedCoupon: { code: "VIP15", discount: 15 } });
    expect(hospedeiro.textContent).not.toContain("Tenho um código de cupom");
    expect(document.getElementById("coupon-code-input")).toBeNull();
  });

  it("sem cupons na vitrine (lista vazia): só o link, sem cabeçalho de lista; carregando e erro mantêm o link", () => {
    montar({ cupons: [], situacao: "pronto" });
    expect(cartoes()).toHaveLength(0);
    expect(hospedeiro.textContent).not.toContain("Cupons disponíveis");
    expect(link()).toBeDefined();
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    montar({ cupons: [], situacao: "carregando" });
    expect(hospedeiro.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(link()).toBeDefined();
  });

  it("o título segue 'Cupons' em texto normal (sem caixa-alta espaçada)", () => {
    montar();
    const titulo = hospedeiro.querySelector("h2");
    expect(titulo?.textContent).toBe("Cupons");
    expect(titulo?.className).not.toContain("uppercase");
    expect(titulo?.className).not.toContain("tracking-");
  });
});
