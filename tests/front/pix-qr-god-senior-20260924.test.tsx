// @vitest-environment jsdom
//
// Tela do Pix com prazo informado e aviso prudente (24/09/2026).
// Sem hora do servidor na resposta, um relógio atrasado inventaria minutos
// restantes; só o banco e o servidor confirmam a validade.
//
// A regra que estes testes seguram (revisão independente, 24/09/2026): o
// relógio do aparelho NÃO é prova de vencimento. Um celular adiantado veria o
// horário "passar" com o Pix ainda valendo no servidor — então, passado o
// horário, QR, código copia e cola, botão de copiar e link do Mercado Pago
// continuam funcionando, inclusive no clique, e a tela nunca afirma "Pix
// expirou". Quem decide o fim é o servidor, pelo status que o CheckoutView
// acompanha.
//
// Relógio: só `Date`, `setInterval` e `clearInterval` são falsos. A montagem
// do Brick depende de `setTimeout` de verdade (`esperarMicrotarefas`), mesmo
// motivo registrado em pix-copiar-codigo-avisa-se-copiou.test.tsx.
import {
  type CategoriaErroPagamento,
  PagamentoOnline,
} from "@/components/checkout/PagamentoOnline";
import { formatCurrency } from "@/lib/utils";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `useOrders` importa `@/lib/supabase`, que explode sem as env vars — dublê
// vazio, porque `useOrders` também é dublê e nada aqui chega ao Supabase.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

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

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QR_CODE_TESTE = "00020126-codigo-pix-de-teste-god-senior";
const TICKET_URL = "https://www.mercadopago.com.br/payments/checkout?id=abc";
const EXPIRA_EM = "2026-09-24T15:30:00.000Z";
const ORDER_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";

const AVISO_HORARIO = "O horário previsto para pagar já passou.";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PagamentoOnline — tela do Pix com prazo dinâmico e aviso estimado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onErro: ReturnType<
    typeof vi.fn<(msg: string, categoria: CategoriaErroPagamento) => void>
  >;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    stubClipboard();
    onErro = vi.fn<(msg: string, categoria: CategoriaErroPagamento) => void>();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    Reflect.deleteProperty(window.navigator, "clipboard");
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Monta o componente de verdade e espera a resposta de `criarPagamento` —
   * disparada DIRETO ao montar desde 25/09/2026 (pedido do dono: PIX sem
   * Brick). `esperarMicrotarefas` continua usando `setTimeout` REAL (fora do
   * `toFake` do `beforeEach`, que só cobre Date/setInterval/clearInterval),
   * então drena a promessa de `criarPagamento` normalmente mesmo com o
   * relógio congelado.
   */
  async function renderComPix(
    resposta?: Partial<{
      qrCode: string;
      qrCodeBase64: string;
      ticketUrl: string;
      expiraEm: string;
    }>,
  ) {
    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: EXPIRA_EM,
      qrCode: QR_CODE_TESTE,
      qrCodeBase64: "abc123",
      ticketUrl: TICKET_URL,
      ...resposta,
    });

    await act(async () => {
      raiz.render(
        <PagamentoOnline orderId={ORDER_ID} valor={129.9} onErro={onErro} />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function botaoCopiar() {
    return [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.includes("Copiar código PIX") ||
        b.textContent?.includes("Copiado!"),
    );
  }

  function linkMercadoPago() {
    return [...hospedeiro.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Pagar pelo Mercado Pago"),
    );
  }

  function imagemQr() {
    return hospedeiro.querySelector<HTMLImageElement>(
      "img[alt='QR code do PIX']",
    );
  }

  function avancar(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  async function clicarCopiar() {
    await act(async () => {
      botaoCopiar()!.click();
      await esperarMicrotarefas();
    });
  }

  /**
   * Passado o horário previsto, TUDO que serve para pagar continua de pé —
   * inclusive o clique, que tem de chegar ao clipboard com o código.
   */
  async function esperarPagamentoAindaPossivel() {
    const img = imagemQr();
    expect(img).not.toBeNull();
    expect(img!.className).not.toContain("blur");
    expect(hospedeiro.textContent).toContain(QR_CODE_TESTE);

    const link = linkMercadoPago();
    expect(link).toBeTruthy();
    expect(link!.href).toBe(TICKET_URL);

    const botao = botaoCopiar();
    expect(botao).toBeTruthy();
    expect(botao!.disabled).toBe(false);
    await clicarCopiar();
    expect(clipboardWriteText).toHaveBeenCalledWith(QR_CODE_TESTE);
    expect(botaoCopiar()!.textContent).toContain("Copiado!");
  }

  /** O relógio local nunca vira afirmação de vencimento. */
  function esperarSemAfirmarVencimento() {
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/expirou/i);
    expect(texto).not.toMatch(/n[aã]o use mais/i);
    expect(texto).not.toMatch(/venceu/i);
  }

  /**
   * O componente não decide o destino do pedido: a única chamada de cobrança
   * é a do envio do Brick, e nenhum erro/terminal é reportado ao pai por
   * causa do relógio.
   */
  function esperarSemNovaCobrancaNemTerminal() {
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(onErro).not.toHaveBeenCalled();
  }

  it("antes do horário: mostra valor, pedido, QR, código e prazo sem prometer minutos", async () => {
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));
    await renderComPix();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(formatCurrency(129.9));
    expect(texto).toContain(`Pedido #${ORDER_ID.slice(0, 8)}`);
    expect(texto).toContain("Código copia e cola");
    expect(texto).toContain("Abra o app do seu banco");
    expect(texto).toContain("Prazo informado: até");
    expect(texto).toContain("Confira a validade no app do seu banco.");
    expect(texto).not.toContain("Faltam");
    expect(texto).not.toContain(AVISO_HORARIO);

    await esperarPagamentoAindaPossivel();
    esperarSemNovaCobrancaNemTerminal();
  });

  it("QR que chega já além do horário previsto: aviso prudente, mas QR, código, cópia e link funcionam", async () => {
    vi.setSystemTime(new Date("2026-09-24T16:00:00.000Z"));
    await renderComPix();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(AVISO_HORARIO);
    expect(texto).toContain("Se você já pagou, continue nesta tela");
    expect(texto).toContain("O prazo informado era até");
    // Uma caixa só: a do prazo sai, o aviso já traz o horário.
    expect(texto).not.toContain("Prazo informado:");
    expect(texto).not.toContain("Faltam");
    esperarSemAfirmarVencimento();

    // O botão aponta para o aviso — o leitor de tela sabe do horário, mas o
    // botão continua ativo.
    const idAviso = botaoCopiar()!.getAttribute("aria-describedby");
    expect(idAviso).toBeTruthy();
    expect(document.getElementById(idAviso!)?.textContent).toContain(
      AVISO_HORARIO,
    );

    await esperarPagamentoAindaPossivel();

    // A checagem periódica permanece para retirar o aviso se o aparelho
    // corrigir o próprio relógio.
    expect(vi.getTimerCount()).toBe(1);
    esperarSemNovaCobrancaNemTerminal();
  });

  it("celular 40 minutos adiantado: servidor ainda dá 10 min, a tela avisa mas copia e link continuam", async () => {
    // O servidor gerou o Pix às 15:20 (UTC) com prazo até 15:30. O relógio
    // DESTE aparelho está 40 min à frente: marca 16:00. Pelo servidor ainda
    // faltam 10 minutos — bloquear aqui seria impedir um pagamento válido.
    vi.setSystemTime(new Date("2026-09-24T16:00:00.000Z"));
    await renderComPix({ expiraEm: "2026-09-24T15:30:00.000Z" });

    expect(hospedeiro.textContent).toContain(AVISO_HORARIO);
    esperarSemAfirmarVencimento();
    await esperarPagamentoAindaPossivel();
    esperarSemNovaCobrancaNemTerminal();
  });

  it("transição pelo relógio: após o horário previsto só avisa, sem bloquear nada", async () => {
    vi.setSystemTime(new Date("2026-09-24T15:29:58.000Z"));
    await renderComPix();

    expect(hospedeiro.textContent).toContain("Prazo informado: até");
    expect(hospedeiro.textContent).not.toContain("Faltam");

    // A região viva existe ANTES do aviso (vazia) — é o MESMO nó que o
    // recebe depois, senão o leitor de tela não anuncia nada.
    const regiaoViva = [
      ...hospedeiro.querySelectorAll('[aria-live="polite"]'),
    ].find((el) => !el.closest("button") && el.getAttribute("role") === null);
    expect(regiaoViva).toBeTruthy();
    expect(regiaoViva!.textContent).toBe("");

    expect(hospedeiro.textContent).not.toContain(AVISO_HORARIO);

    avancar(10_000);
    expect(regiaoViva!.isConnected).toBe(true);
    expect(regiaoViva!.textContent).toContain(AVISO_HORARIO);
    expect(hospedeiro.textContent).not.toContain("Faltam");
    esperarSemAfirmarVencimento();

    // A checagem continua para perceber eventual correção do relógio.
    expect(vi.getTimerCount()).toBe(1);

    await esperarPagamentoAindaPossivel();
    esperarSemNovaCobrancaNemTerminal();
  });

  it("falha de cópia antes do horário: o campo com o código CONTINUA depois que o horário passa", async () => {
    clipboardWriteText = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError"));
    vi.setSystemTime(new Date("2026-09-24T15:29:59.000Z"));
    await renderComPix();

    await clicarCopiar();
    const campo = hospedeiro.querySelector("textarea");
    expect(campo).not.toBeNull();

    avancar(10_000);
    expect(hospedeiro.textContent).toContain(AVISO_HORARIO);
    expect(hospedeiro.querySelector("textarea")?.value).toBe(QR_CODE_TESTE);
    esperarSemAfirmarVencimento();
    esperarSemNovaCobrancaNemTerminal();
  });

  it("aba volta do segundo plano depois do horário: o aviso aparece na hora, e pagar continua possível", async () => {
    vi.setSystemTime(new Date("2026-09-24T15:20:00.000Z"));
    await renderComPix();
    expect(hospedeiro.textContent).toContain("Prazo informado: até");

    // O relógio anda SEM disparar o intervalo — é o que o navegador faz com
    // timer de aba escondida enquanto o cliente paga no app do banco.
    vi.setSystemTime(new Date("2026-09-24T15:45:00.000Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(hospedeiro.textContent).toContain(AVISO_HORARIO);
    esperarSemAfirmarVencimento();
    await esperarPagamentoAindaPossivel();
    esperarSemNovaCobrancaNemTerminal();
  });

  it("prazo ilegível: não inventa horário nem avisa nada — a cópia continua valendo", async () => {
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));
    await renderComPix({ expiraEm: "prazo-que-nao-e-data" });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Não conseguimos ler o prazo deste Pix.");
    expect(texto).not.toContain("Prazo informado:");
    expect(texto).not.toContain(AVISO_HORARIO);
    expect(texto).not.toContain("Invalid Date");
    expect(vi.getTimerCount()).toBe(0);
    await esperarPagamentoAindaPossivel();
  });

  it("sem imagem do QR: diz o que falta e aponta para o código copia e cola", async () => {
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));
    await renderComPix({ qrCodeBase64: undefined });

    expect(imagemQr()).toBeNull();
    expect(hospedeiro.textContent).toContain(
      "A imagem do QR code não veio nesta cobrança. Use o código copia e cola acima.",
    );
    expect(botaoCopiar()!.disabled).toBe(false);
  });

  it("celular: o botão de copiar vem ANTES do QR, com alvo de toque de 48px e texto legível", async () => {
    // Quem paga no mesmo aparelho não escaneia a própria tela: copiar é o
    // caminho principal e tem de aparecer primeiro.
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));
    await renderComPix();

    const botao = botaoCopiar()!;
    const img = imagemQr()!;
    expect(
      botao.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(botao.className).toContain("min-h-12");
    expect(botao.className).toContain("text-sm");
    expect(hospedeiro.textContent).toContain(
      "Pagando por outro aparelho? Escaneie o QR code.",
    );

    // O código visível não usa mais a fonte de 10px.
    const codigoVisivel = [...hospedeiro.querySelectorAll("p")].find(
      (p) => p.textContent === QR_CODE_TESTE,
    );
    expect(codigoVisivel).toBeTruthy();
    expect(codigoVisivel!.className).not.toContain("text-[10px]");
    expect(codigoVisivel!.className).toContain("text-xs");

    await clicarCopiar();
    expect(botaoCopiar()!.textContent).toContain(
      "Copiado! Cole no app do seu banco",
    );
  });

  it("passado o horário pelo relógio local, a caixa do prazo dá lugar ao aviso — e volta se o relógio for corrigido", async () => {
    vi.setSystemTime(new Date("2026-09-24T15:20:00.000Z"));
    await renderComPix();
    expect(hospedeiro.textContent).toContain("Prazo informado: até");

    vi.setSystemTime(new Date("2026-09-24T15:31:00.000Z"));
    avancar(10_000);
    expect(hospedeiro.textContent).not.toContain("Prazo informado:");
    expect(hospedeiro.textContent).toContain(AVISO_HORARIO);
    await esperarPagamentoAindaPossivel();

    vi.setSystemTime(new Date("2026-09-24T15:21:00.000Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(hospedeiro.textContent).toContain("Prazo informado: até");
    expect(hospedeiro.textContent).not.toContain(AVISO_HORARIO);
    esperarSemNovaCobrancaNemTerminal();
  });
});
