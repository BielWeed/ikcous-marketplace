// @vitest-environment jsdom
//
// Brief "o app não mente quando copia" (08/09/2026) — o botão "Copiar código
// PIX" chamava `navigator.clipboard.writeText(pix.qrCode ?? "")` sem await,
// sem catch e SEM NENHUM retorno visual, nem quando dava certo. Agora usa
// `copiarParaClipboard` (mesma peça do painel, `src/lib/copiar-para-clipboard.ts`):
// sucesso -> o próprio botão diz "Copiado!" por ~2s; falha -> aparece o
// código num campo selecionável com uma frase leiga de instrução, porque o
// PIX é o único ponto de atenção da tela e o cliente precisa conseguir pagar
// mesmo sem a cópia automática.
//
// Montagem: mesmo helper `renderComPix` de pagamento-online.test.tsx (dispara
// o `onSubmit` do Brick sem token = caminho PIX), com o clipboard estubado no
// padrão de ficha-do-pedido-copiar-endereco-falha-avisa.test.tsx.
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mesmo motivo de pagamento-online.test.tsx: `useOrders` importa
// `@/lib/supabase`, que explode sem as env vars do Supabase — o dublê fica
// vazio porque nada aqui chama Supabase de verdade.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

// `vi.hoisted` para a factory do mock e o helper `renderComPix` (mais abaixo)
// compartilharem a MESMA referência — mesmo padrão de pagamento-online.test.tsx.
const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

let clipboardWriteText: (texto: string) => Promise<void> = vi
  .fn()
  .mockResolvedValue(undefined);

function stubClipboard() {
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      writeText: (...args: Parameters<typeof clipboardWriteText>) =>
        clipboardWriteText(...args),
    },
    configurable: true,
  });
}

const QR_CODE_TESTE = "000201-codigo-pix-de-teste";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Espera a fila de microtarefas drenar por inteiro — mesmo helper de pagamento-online.test.tsx. */
function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PagamentoOnline — o botão de copiar o PIX diz se copiou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    document.head.innerHTML = "";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    stubClipboard();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.querySelectorAll("script[data-mp-sdk]").forEach((s) => s.remove());
    // @ts-expect-error limpando o global entre testes
    globalThis.MercadoPago = undefined;
    Reflect.deleteProperty(window.navigator, "clipboard");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /**
   * Renderiza o componente de verdade e dispara o `onSubmit` do Brick (PIX,
   * sem token) — mesmo caminho de `renderComPix` em pagamento-online.test.tsx.
   *
   * `resposta` permite ao chamador sobrescrever o que `criarPagamento`
   * resolve — usado pelo teste do estado `{qrCodeBase64, qrCode: undefined}`
   * (A-1 do laudo Opus), que a edge de fato pode devolver porque extrai os
   * dois campos em separado.
   */
  async function renderComPix(
    resposta?: Partial<{
      qrCode: string;
      qrCodeBase64: string;
      ticketUrl: string;
    }>,
  ) {
    const create = vi.fn().mockResolvedValue({ unmount: vi.fn() });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: "2026-08-06T15:30:00.000Z",
      qrCode: QR_CODE_TESTE,
      qrCodeBase64: "abc123",
      ...resposta,
    });

    await act(async () => {
      raiz.render(
        <PagamentoOnline orderId="ped-1" valor={100} onErro={() => {}} />,
      );
    });

    document
      .querySelector("script[data-mp-sdk]")
      ?.dispatchEvent(new Event("load"));
    await act(async () => {
      await esperarMicrotarefas();
    });

    const { onSubmit } = create.mock.calls[0][2].callbacks;
    await act(async () => {
      await onSubmit({ formData: {} }); // sem token => PIX
    });
  }

  function botaoCopiar() {
    return [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.includes("Copiar código PIX") ||
        b.textContent?.includes("Copiado!"),
    );
  }

  it("clipboard resolve: o botão passa a dizer 'Copiado!' e recebeu o código PIX", async () => {
    await renderComPix();

    const botao = botaoCopiar();
    expect(botao).toBeTruthy();
    expect(botao!.textContent).toContain("Copiar código PIX");

    await act(async () => {
      botao!.click();
      await esperarMicrotarefas();
    });

    expect(clipboardWriteText).toHaveBeenCalledWith(QR_CODE_TESTE);
    expect(botaoCopiar()!.textContent).toContain("Copiado!");
  });

  it("clipboard rejeita: o botão NÃO diz 'Copiado!', aparece o código selecionável com a instrução", async () => {
    clipboardWriteText = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError"));

    await renderComPix();

    const botao = botaoCopiar();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.click();
      await esperarMicrotarefas();
    });

    expect(botaoCopiar()!.textContent).not.toContain("Copiado!");
    expect(hospedeiro.textContent).toContain(
      "Não consegui copiar sozinho. Toque no código abaixo, segure e copie.",
    );

    const campo = hospedeiro.querySelector("textarea, input[readonly]") as
      | HTMLTextAreaElement
      | HTMLInputElement
      | null;
    expect(campo).toBeTruthy();
    // Laudo Opus A-4 (08/09/2026): o seletor `"textarea, input[readonly]"`
    // casa QUALQUER textarea, com ou sem `readOnly` — só o ramo `input`
    // exige o atributo. Asserção explícita fecha a lacuna.
    expect(campo!.readOnly).toBe(true);
    expect(campo!.value).toBe(QR_CODE_TESTE);
  });

  it("A-1: sem qrCode (só qrCodeBase64), não existe botão de copiar nem campo de falha — QR e link continuam", async () => {
    await renderComPix({
      qrCode: undefined,
      qrCodeBase64: "abc123",
      ticketUrl: "https://mercadopago.com/ticket/abc",
    });

    expect(botaoCopiar()).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain(
      "Não consegui copiar sozinho. Toque no código abaixo, segure e copie.",
    );
    expect(hospedeiro.querySelector("textarea")).toBeNull();
    expect(hospedeiro.querySelector("img[alt='QR code do PIX']")).toBeTruthy();
    expect(
      [...hospedeiro.querySelectorAll("a")].find((a) =>
        a.textContent?.includes("Pagar pelo Mercado Pago"),
      ),
    ).toBeTruthy();
  });

  it("A-2: clipboard rejeita — a região role=status contém a frase de instrução", async () => {
    clipboardWriteText = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError"));

    await renderComPix();

    const botao = botaoCopiar();
    await act(async () => {
      botao!.click();
      await esperarMicrotarefas();
    });

    const regiao = hospedeiro.querySelector('[role="status"]');
    expect(regiao).toBeTruthy();
    expect(regiao!.textContent).toContain(
      "Não consegui copiar sozinho. Toque no código abaixo, segure e copie.",
    );
  });

  it("depois de 2s, 'Copiado!' volta a 'Copiar código PIX'", async () => {
    // Timers de verdade: `renderComPix`/`esperarMicrotarefas` dependem de
    // `setTimeout` real, e fake timers globais travariam a montagem do SDK.
    // Só o intervalo de 2s do próprio `handleCopiarPix` importa aqui.
    await renderComPix();

    const botao = botaoCopiar();
    await act(async () => {
      botao!.click();
      await esperarMicrotarefas();
    });
    expect(botaoCopiar()!.textContent).toContain("Copiado!");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2100));
    });
    expect(botaoCopiar()!.textContent).toContain("Copiar código PIX");
  }, 10000);
});
