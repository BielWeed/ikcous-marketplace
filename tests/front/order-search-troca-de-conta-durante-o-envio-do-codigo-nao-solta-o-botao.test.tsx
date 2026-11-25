// @vitest-environment jsdom
/**
 * Caça por mutação (25/11/2026), OrderSearch. A troca de conta na sessão solta o "carregando"
 * de uma VERIFICAÇÃO abandonada (testado no vizinho), mas NÃO pode soltar o de um ENVIO de
 * código ainda no ar: o envio tem o seu próprio fim. Soltar antes deixa o botão "Enviar Código"
 * livre com o pedido anterior ainda voltando, e um segundo toque dispara o mesmo envio de novo
 * (o servidor só aceita um código por minuto: a cliente leva "muito recente").
 */
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const generateOrderOtp = vi.fn();
const fetchOrdersByOtp = vi.fn();
const estado: { user: { id: string } | null } = { user: null };

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    generateOrderOtp,
    fetchOrdersByOtp,
    idDaConta: estado.user?.id ?? null,
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {}, heavy: () => {} },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(host: HTMLElement, placeholder: string, valor: string) {
  const campo = host.querySelector<HTMLInputElement>(
    `[placeholder="${placeholder}"]`,
  );
  if (!campo) throw new Error(`campo não encontrado: ${placeholder}`);
  Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("OrderSearch: troca de conta com o envio do código ainda no ar", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  let concluirEnvio!: (ok: boolean) => void;

  beforeAll(async () => {
    await import("@/components/ui/custom/OrderSearch");
  }, 60_000);

  beforeEach(() => {
    generateOrderOtp.mockReset();
    fetchOrdersByOtp.mockReset();
    estado.user = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function renderizar() {
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} abrirNoRastreio />);
    });
  }
  const botaoEnviar = () =>
    host.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    ) as HTMLButtonElement;

  it("o botão segue em 'Gerando Código...' até o envio terminar, mesmo com outra conta entrando", async () => {
    generateOrderOtp.mockReturnValue(
      new Promise<boolean>((resolve) => {
        concluirEnvio = resolve;
      }),
    );
    await renderizar();
    await act(async () => {
      digitar(host, "SEU E-MAIL", "pessoa@fixture.invalid");
      digitar(host, "SEU WHATSAPP", "11999999999");
      digitar(host, "6 FINAIS DO ID DO PEDIDO", "abcdef");
    });
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    expect(botaoEnviar().textContent).toContain("Gerando Código");
    expect(botaoEnviar().disabled).toBe(true);

    estado.user = { id: "conta-da-pessoa-b" };
    await renderizar();
    expect(botaoEnviar().textContent).toContain("Gerando Código");
    expect(botaoEnviar().disabled).toBe(true);
    expect(generateOrderOtp).toHaveBeenCalledTimes(1);

    await act(async () => {
      concluirEnvio(false);
      await Promise.resolve();
    });
    expect(botaoEnviar().textContent).toContain("Enviar Código");
    expect(botaoEnviar().disabled).toBe(false);
  });
});
