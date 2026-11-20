// @vitest-environment jsdom
/**
 * OrderSearch — quem comprou SEM conta não pode ficar preso num formulário
 * que nunca acha o pedido dela.
 *
 * O encadeamento, medido no código de 14/10/2026:
 *   1. a compra da convidada grava `customer_data = {whatsapp, address, ...}`
 *      e NUNCA e-mail (create_marketplace_order_v24 não tem `p_customer_email`;
 *      o formulário da convidada não pede e-mail);
 *   2. "Rastrear sem Conta" pede código por `generate_order_otp_v2`, que só
 *      casa quando `customer_data->>'email'` (ou o e-mail da conta) é igual ao
 *      digitado;
 *   3. logo, para o pedido de convidada o resultado é sempre "Não encontramos
 *      um pedido com esse e-mail, WhatsApp e ID juntos" — mesmo com TODOS os
 *      dados certos. Ela conclui que o pedido sumiu.
 *
 * A saída honesta (sem abrir leitura pública nova): a aba diz isso ANTES de
 * ela digitar e entrega o que funciona de verdade — falar com a loja pelo
 * WhatsApp com o identificador do pedido (o mesmo caminho já usado na tela
 * "Pedido recebido!"). Sem WhatsApp na loja: instrução, nunca botão morto.
 */
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// outros testes de tela desta pasta.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const generateOrderOtp = vi.fn();
const fetchOrdersByOtp = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ generateOrderOtp, fetchOrdersByOtp }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {}, heavy: () => {} },
}));

const AVISO = "Comprou sem criar conta?";
const BOTAO = "Falar com a loja no WhatsApp";

function botaoPorTexto(raiz: HTMLElement, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
}

describe("OrderSearch — aviso para quem comprou sem conta", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    generateOrderOtp.mockReset();
    fetchOrdersByOtp.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    document.getSelection()?.removeAllRanges();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function abrirRastrearSemConta(whatsappDaLoja?: string | null) {
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(
        <OrderSearch onNavigate={() => {}} whatsappDaLoja={whatsappDaLoja} />,
      );
    });
    await act(async () => {
      botaoPorTexto(host, "Rastrear sem Conta")?.click();
    });
  }

  it("loja com WhatsApp: avisa que o rastreio é por e-mail e oferece falar com a loja (número com DDI 55, sem opener)", async () => {
    await abrirRastrearSemConta("(34) 99999-8888");

    expect(host.textContent).toContain(AVISO);
    expect(host.textContent).toContain("identificador do pedido");

    const abrir = vi.fn();
    vi.stubGlobal("open", abrir);
    const botao = botaoPorTexto(host, BOTAO);
    expect(botao).not.toBeUndefined();
    await act(async () => {
      botao?.click();
    });

    expect(abrir).toHaveBeenCalledTimes(1);
    const [url, alvo, recursos] = abrir.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(url).toContain("https://wa.me/5534999998888");
    expect(decodeURIComponent(url)).toContain("sem criar conta");
    // A URL CRUA tem de sair codificada: espaço, acento e "!" no texto do
    // wa.me. Sem isto o teste acima (que decodifica) passaria até com a
    // mensagem colada sem encodeURIComponent.
    expect(url).toContain("?text=Ol%C3%A1!%20Fiz%20um%20pedido%20sem%20criar");
    expect(url).not.toContain(" ");
    expect(alvo).toBe("_blank");
    expect(recursos).toBe("noopener,noreferrer");
  });

  it("explica antes dos campos que pedido sem e-mail deve ser consultado pelo WhatsApp", async () => {
    await abrirRastrearSemConta("34999998888");

    const aviso = [...host.querySelectorAll("p")].find((p) =>
      p.textContent?.includes(
        "Pedidos feitos sem e-mail, só com WhatsApp e pagamento na entrega, não aparecem aqui; fale com a loja pelo WhatsApp.",
      ),
    );
    const email = host.querySelector('input[type="email"]');
    expect(aviso).toBeDefined();
    expect(email).not.toBeNull();
    expect(
      aviso!.compareDocumentPosition(email!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    ["3884BE", "3884BE"],
    ["  3884BE  ", "3884BE"],
    ["# 3884 BE ", "3884BE"],
    ["", null],
    ["123", null],
    ["3884ZZ", null],
    ["3884BE&#", null],
    ["Olá", null],
  ])(
    "leva ao WhatsApp o identificador válido normalizado: %j",
    async (digitado, esperado) => {
      await abrirRastrearSemConta("34999998888");
      const campo = host.querySelector<HTMLInputElement>(
        '[placeholder="6 FINAIS DO ID DO PEDIDO"]',
      );
      if (!campo) throw new Error("campo do identificador não encontrado");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set?.call(campo, digitado);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const abrir = vi.fn();
      vi.stubGlobal("open", abrir);
      await act(async () => {
        botaoPorTexto(host, BOTAO)?.click();
      });

      expect(abrir).toHaveBeenCalledTimes(1);
      const url = new URL(abrir.mock.calls.at(0)?.at(0) as string);
      const mensagem = esperado
        ? `Olá! Fiz um pedido sem criar conta e quero acompanhar. O identificador do pedido é: ${esperado}`
        : "Olá! Fiz um pedido sem criar conta e quero acompanhar. Podem me ajudar a localizar o pedido?";
      expect(url.searchParams.get("text")).toBe(mensagem);
      expect(url.search).toBe(`?text=${encodeURIComponent(mensagem)}`);
      expect(url.hash).toBe("");
      expect([...url.searchParams.keys()]).toEqual(["text"]);
      if (!esperado) {
        expect(url.searchParams.get("text")).not.toContain(
          "identificador do pedido é:",
        );
      }
    },
  );

  it("o botão do WhatsApp tem área de toque de pelo menos 44px (min-h-12 = 48px)", async () => {
    await abrirRastrearSemConta("34999998888");

    const botao = botaoPorTexto(host, BOTAO);
    expect(botao).not.toBeUndefined();
    // 48px (>= 44px): o rótulo é longo e quebra em duas linhas em 320px, então
    // a altura é MÍNIMA (min-h-12), nunca fixa — o texto nunca é cortado.
    expect(botao?.className.split(/\s+/)).toContain("min-h-12");
  });

  it("mostra o número da loja e permite copiá-lo sem abrir outra aba", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await abrirRastrearSemConta("+55 34 99999-8888");

    expect(host.textContent).toContain("(34) 99999-8888");
    expect(host.textContent).toContain(
      "Use o contato da loja que você já tem.",
    );
    await act(async () => botaoPorTexto(host, "Copiar número")?.click());

    expect(writeText).toHaveBeenCalledWith("(34) 99999-8888");
    expect(toast.success).toHaveBeenCalledWith("Copiado!");
  });

  it("seleciona o número sem anunciar cópia quando a área de transferência falha", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Bloqueado"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await abrirRastrearSemConta("34999998888");

    await act(async () => botaoPorTexto(host, "Copiar número")?.click());

    expect(writeText).toHaveBeenCalledWith("(34) 99999-8888");
    expect(document.getSelection()?.toString()).toBe("(34) 99999-8888");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("loja SEM WhatsApp: instrução honesta, nunca um botão morto", async () => {
    await abrirRastrearSemConta(undefined);

    expect(host.textContent).toContain(AVISO);
    expect(host.textContent).toContain("contato da loja");
    expect(botaoPorTexto(host, BOTAO)).toBeUndefined();
    expect(botaoPorTexto(host, "WhatsApp")).toBeUndefined();
    expect(botaoPorTexto(host, "Copiar número")).toBeUndefined();
    expect(host.textContent).not.toContain("WhatsApp da loja:");
  });

  it("número curto demais não vira botão (mesma régua do resto do app)", async () => {
    await abrirRastrearSemConta("123");

    expect(host.textContent).toContain(AVISO);
    expect(botaoPorTexto(host, BOTAO)).toBeUndefined();
  });

  it("o aviso só aparece na aba 'Rastrear sem Conta' (quem tem conta não o lê)", async () => {
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(
        <OrderSearch onNavigate={() => {}} whatsappDaLoja="34999998888" />,
      );
    });
    // Abre na aba de login.
    expect(host.textContent).not.toContain(AVISO);
  });

  it("o formulário de rastreio continua inteiro ao lado do aviso", async () => {
    await abrirRastrearSemConta("34999998888");

    expect(host.querySelector('[placeholder="SEU E-MAIL"]')).not.toBeNull();
    expect(botaoPorTexto(host, "Enviar Código")).not.toBeUndefined();
  });
});
