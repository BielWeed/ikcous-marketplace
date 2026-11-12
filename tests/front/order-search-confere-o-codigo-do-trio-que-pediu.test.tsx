// @vitest-environment jsdom
/**
 * OrderSearch — o código é conferido contra o trio que PEDIU o código.
 *
 * O defeito: o envio lê e-mail, WhatsApp e fragmento do pedido no clique, mas
 * durante o `await` (rede lenta) os campos continuam editáveis. Se a cliente
 * mexe no fragmento enquanto espera, o envio termina, a tela abre a etapa do
 * código e a verificação lia os campos de AGORA — o código certo do pedido A não
 * achava A, e a tentativa errada era contada contra o pedido B
 * (get_orders_by_otp_v2). A tela passa a guardar o trio do envio que deu certo.
 *
 * Mesma convenção de order-search-manda-o-trio-na-verificacao.test.tsx: DOM real
 * via react-dom/client, campos achados pelo placeholder, hook mockado.
 */
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateOrderOtp = vi.fn();
const fetchOrdersByOtp = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ generateOrderOtp, fetchOrdersByOtp }),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {}, heavy: () => {} },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CAMPO_EMAIL = "SEU E-MAIL";
const CAMPO_ZAP = "SEU WHATSAPP";
const CAMPO_FRAGMENTO = "6 FINAIS DO ID DO PEDIDO";
const CAMPO_CODIGO = "DIGITE O CÓDIGO DE 6 DÍGITOS";
const JA_TENHO = "Já tenho o código";

const A = { email: "cliente@exemplo.test", zap: "34999990001", id: "ABC123" };
const B = { email: "outra@exemplo.test", zap: "11988880002", id: "DEF456" };

function porPlaceholder(raiz: HTMLElement, texto: string) {
  return raiz.querySelector<HTMLInputElement>(`[placeholder="${texto}"]`);
}

function digitar(raiz: HTMLElement, placeholder: string, valor: string) {
  const campo = porPlaceholder(raiz, placeholder);
  if (!campo) throw new Error(`campo não encontrado: ${placeholder}`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

async function clicar(raiz: HTMLElement, texto: string) {
  const botao = [...raiz.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!botao) throw new Error(`botão não encontrado: ${texto}`);
  await act(async () => {
    botao.click();
  });
}

async function preencher(raiz: HTMLElement, d: typeof A) {
  await act(async () => {
    digitar(raiz, CAMPO_EMAIL, d.email);
    digitar(raiz, CAMPO_ZAP, d.zap);
    digitar(raiz, CAMPO_FRAGMENTO, d.id);
  });
}

async function submeter(raiz: HTMLElement) {
  await act(async () => {
    raiz.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function digitarCodigoEConfirmar(raiz: HTMLElement) {
  await act(async () => {
    digitar(raiz, CAMPO_CODIGO, "123456");
  });
  await submeter(raiz);
}

/** Promessa que a prova resolve quando quiser: o "rede lenta" do envio. */
function envioSegurado() {
  let resolver: (ok: boolean) => void = () => {};
  const promessa = new Promise<boolean>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

const trioDe = (d: typeof A) => ({
  whatsapp: d.zap,
  fragmento: d.id,
});

describe("OrderSearch — o código é conferido contra o trio que pediu", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(async () => {
    generateOrderOtp.mockReset();
    fetchOrdersByOtp.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    fetchOrdersByOtp.mockResolvedValue([]);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });
    await clicar(host, "Rastrear sem Conta");
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  it("(1) mexer no fragmento enquanto o envio espera NÃO troca o pedido conferido", async () => {
    const envio = envioSegurado();
    generateOrderOtp.mockReturnValueOnce(envio.promessa);
    await preencher(host, A);
    await submeter(host);
    expect(generateOrderOtp).toHaveBeenCalledWith(A.email, A.zap, A.id);

    // Rede lenta: a cliente ainda enxerga os campos e troca o fragmento.
    await act(async () => {
      digitar(host, CAMPO_FRAGMENTO, B.id);
    });

    await act(async () => {
      envio.resolver(true);
      await envio.promessa;
    });
    expect(porPlaceholder(host, CAMPO_CODIGO)).not.toBeNull();

    await digitarCodigoEConfirmar(host);

    expect(fetchOrdersByOtp).toHaveBeenCalledTimes(1);
    expect(fetchOrdersByOtp).toHaveBeenCalledWith(A.email, "123456", {
      whatsapp: A.zap,
      fragmento: A.id,
    });
  });

  it("(1b) trocar os três campos durante a espera: confere e mostra o e-mail de quem pediu", async () => {
    const envio = envioSegurado();
    generateOrderOtp.mockReturnValueOnce(envio.promessa);
    await preencher(host, A);
    await submeter(host);

    await preencher(host, B);
    await act(async () => {
      envio.resolver(true);
      await envio.promessa;
    });

    expect(host.textContent).toContain(`Código enviado para ${A.email}`);
    expect(host.textContent).not.toContain(B.email);

    await digitarCodigoEConfirmar(host);

    expect(fetchOrdersByOtp).toHaveBeenCalledWith(A.email, "123456", trioDe(A));
  });

  it("(2) controle: sem mexer em nada, o trio é o de sempre (e-mail normalizado, só dígitos, sem #)", async () => {
    generateOrderOtp.mockResolvedValueOnce(true);
    await preencher(host, {
      email: " Cliente@Exemplo.test ",
      zap: "(34) 99999-0001",
      id: "#ABC123",
    });
    await submeter(host);
    expect(generateOrderOtp).toHaveBeenCalledWith(A.email, A.zap, A.id);

    await digitarCodigoEConfirmar(host);

    expect(fetchOrdersByOtp).toHaveBeenCalledWith(A.email, "123456", trioDe(A));
  });

  it("(3) envio que FALHA não fixa trio: 'Já tenho o código' usa os campos atuais", async () => {
    generateOrderOtp.mockResolvedValueOnce(false);
    await preencher(host, A);
    await submeter(host);
    // Falhou: continua na etapa de dados.
    expect(porPlaceholder(host, CAMPO_CODIGO)).toBeNull();

    // A cliente corrige os dados e usa o código que já tinha.
    await preencher(host, B);
    await clicar(host, JA_TENHO);
    await digitarCodigoEConfirmar(host);

    expect(fetchOrdersByOtp).toHaveBeenCalledWith(B.email, "123456", trioDe(B));
  });

  it("(3b) envio que lança erro também não fixa trio", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    generateOrderOtp.mockRejectedValueOnce(new Error("rede caiu"));
    await preencher(host, A);
    await submeter(host);
    expect(porPlaceholder(host, CAMPO_CODIGO)).toBeNull();

    await preencher(host, B);
    await clicar(host, JA_TENHO);
    await digitarCodigoEConfirmar(host);

    expect(fetchOrdersByOtp).toHaveBeenCalledWith(B.email, "123456", trioDe(B));
    erro.mockRestore();
  });

  it("(4) Voltar solta o trio: um novo caminho até o código usa os campos atuais", async () => {
    generateOrderOtp.mockResolvedValueOnce(true);
    await preencher(host, A);
    await submeter(host);
    expect(porPlaceholder(host, CAMPO_CODIGO)).not.toBeNull();

    await clicar(host, "Voltar");
    expect(porPlaceholder(host, CAMPO_CODIGO)).toBeNull();

    // Edita os dados e volta ao código sem novo envio.
    await preencher(host, B);
    await clicar(host, JA_TENHO);
    await digitarCodigoEConfirmar(host);

    expect(generateOrderOtp).toHaveBeenCalledTimes(1);
    expect(fetchOrdersByOtp).toHaveBeenCalledWith(B.email, "123456", trioDe(B));
  });

  it("(4b) Voltar e novo envio com dados editados: o trio passa a ser o do novo envio", async () => {
    generateOrderOtp.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    await preencher(host, A);
    await submeter(host);
    await clicar(host, "Voltar");

    await preencher(host, B);
    await submeter(host);
    expect(generateOrderOtp).toHaveBeenLastCalledWith(B.email, B.zap, B.id);

    await digitarCodigoEConfirmar(host);

    expect(fetchOrdersByOtp).toHaveBeenCalledWith(B.email, "123456", trioDe(B));
  });
});
