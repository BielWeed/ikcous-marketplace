// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { OrderList } from "@/components/ui/custom/OrderList";

// 27/11/2026: "Você ainda não fez nenhum pedido" e "Comprou com outro e-mail?
// Entre com o usado na compra." eram falsos para quem comprou SEM entrar na
// conta (o pedido não fica ligado a conta nenhuma) e depois criou a conta com
// o mesmo e-mail.
//
// 27/11/2026 (2): a consulta só acha pedido pelo e-mail gravado nele ou pelo
// da conta que comprou — a compra SEM conta não grava e-mail
// (get_orders_by_otp_v2), então "Consultar pedido feito sem conta" prometia o
// que não existe. Agora a frase diz que esse pedido não aparece nem na
// consulta e leva à loja (WhatsApp, quando a loja tem); a consulta é para o
// pedido feito em OUTRA conta.
const FRASE =
  "Comprou sem entrar na conta? Esse pedido não aparece aqui nem na consulta: fale com a loja informando o número do pedido.";
const CONSULTAR = "Consultar pedido feito em outra conta (outro e-mail)";
const PROMESSA_FALSA = "Consultar pedido feito sem conta";
const WHATSAPP = "Falar com a loja no WhatsApp";

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
    // Sem o WhatsApp da loja, nenhum botão de WhatsApp (a frase já orienta).
    expect(botao(WHATSAPP)).toBeUndefined();
  } finally {
    desmontar();
  }
});

it("com a consulta disponível, o botão a abre", async () => {
  const onConsultarSemConta = vi.fn();
  const { tela, botao, desmontar } = await montar({ onConsultarSemConta });
  try {
    const consultar = botao(CONSULTAR);
    expect(consultar).toBeDefined();
    expect(tela.textContent).not.toContain(PROMESSA_FALSA);
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

it("com o WhatsApp da loja, quem comprou sem conta fala com a loja por ele", async () => {
  const abrir = vi.fn();
  const { botao, desmontar } = await montar({
    whatsappDaLoja: "(11) 90000-0000",
  });
  vi.stubGlobal("open", abrir);
  try {
    const whatsapp = botao(WHATSAPP);
    expect(whatsapp).toBeDefined();
    expect(whatsapp?.getAttribute("type")).toBe("button");
    await act(async () => whatsapp?.click());
    expect(abrir).toHaveBeenCalledTimes(1);
    const [url, alvo, recursos] = abrir.mock.calls[0];
    expect(url).toMatch(/^https:\/\/wa\.me\/5511900000000\?text=/);
    expect(decodeURIComponent(String(url).split("?text=")[1])).toContain(
      "Fiz um pedido sem entrar na conta",
    );
    expect(alvo).toBe("_blank");
    expect(recursos).toContain("noopener");
  } finally {
    desmontar();
  }
});

it("LIMITE: número da loja inválido ou zerado não vira botão de WhatsApp (link sem destinatário)", async () => {
  for (const whatsappDaLoja of ["0000000000", "123", "", null]) {
    const { tela, botao, desmontar } = await montar({ whatsappDaLoja });
    try {
      expect(botao(WHATSAPP), String(whatsappDaLoja)).toBeUndefined();
      expect(tela.textContent, String(whatsappDaLoja)).toContain(FRASE);
    } finally {
      desmontar();
    }
  }
});
