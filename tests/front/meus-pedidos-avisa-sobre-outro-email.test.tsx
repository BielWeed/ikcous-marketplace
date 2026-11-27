// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { OrderList } from "@/components/ui/custom/OrderList";

// 27/11/2026: "Você ainda não fez nenhum pedido" e "Comprou com outro e-mail?
// Entre com o usado na compra." eram falsos para quem comprou SEM entrar na
// conta (o pedido não fica ligado a conta nenhuma) e depois criou a conta com
// o mesmo e-mail. A frase nova vale para os dois casos.
const FRASE =
  "Comprou sem entrar na conta, ou com outro e-mail? Esse pedido não aparece aqui.";
const CONSULTAR = "Consultar pedido feito sem conta";

async function montar(props: Partial<Parameters<typeof OrderList>[0]>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const tela = document.createElement("div");
  const raiz = createRoot(tela);
  const navegar = vi.fn();
  await act(async () => {
    raiz.render(
      <OrderList
        orders={[]}
        hasAnyOrders={false}
        onNavigate={navegar}
        {...props}
      />,
    );
  });
  const botao = (texto: string) =>
    [...tela.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
  const desmontar = () => {
    act(() => raiz.unmount());
    vi.unstubAllGlobals();
  };
  return { tela, navegar, botao, desmontar };
}

it("conta sem pedidos diz a verdade para quem comprou sem entrar ou com outro e-mail e mantém a ida à vitrine", async () => {
  const { tela, navegar, botao, desmontar } = await montar({});
  try {
    expect(tela.textContent).toContain("Nenhum pedido feito nesta conta.");
    expect(tela.textContent).toContain(FRASE);
    expect(tela.textContent).not.toContain("Você ainda não fez nenhum pedido");
    expect(tela.textContent).not.toContain("Entre com o usado na compra");
    const vitrine = botao("Ver produtos");
    expect(vitrine).toBeDefined();
    await act(async () => vitrine?.click());
    expect(navegar).toHaveBeenCalledWith("home");
    // Sem quem abra a consulta, nenhum botão que não faz nada.
    expect(botao(CONSULTAR)).toBeUndefined();
  } finally {
    desmontar();
  }
});

it("com a consulta disponível, o botão a abre", async () => {
  const onConsultarSemConta = vi.fn();
  const { botao, desmontar } = await montar({ onConsultarSemConta });
  try {
    const consultar = botao(CONSULTAR);
    expect(consultar).toBeDefined();
    expect(consultar?.getAttribute("type")).toBe("button");
    await act(async () => consultar?.click());
    expect(onConsultarSemConta).toHaveBeenCalledTimes(1);
  } finally {
    desmontar();
  }
});

it("LIMITE: aba filtrada vazia (há pedidos), descrição própria, convidado ou lista compacta não oferecem a consulta", async () => {
  const onConsultarSemConta = vi.fn();
  for (const extra of [
    { hasAnyOrders: true },
    { emptyDescription: "Nada por aqui." },
    { isGuest: true },
    { compact: true },
  ]) {
    const { tela, botao, desmontar } = await montar({
      onConsultarSemConta,
      ...extra,
    });
    try {
      expect(botao(CONSULTAR), JSON.stringify(extra)).toBeUndefined();
      if (!("compact" in extra))
        expect(tela.textContent, JSON.stringify(extra)).not.toContain(FRASE);
    } finally {
      desmontar();
    }
  }
});
