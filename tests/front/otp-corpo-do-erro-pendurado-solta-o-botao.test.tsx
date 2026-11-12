// @vitest-environment jsdom
/**
 * Pedir o código por e-mail para consultar o pedido sem login, com a rede
 * "pendurada" NO CORPO do erro (12/11/2026).
 *
 * O defeito: `send-otp-email` respondeu com erro HTTP (os cabeçalhos chegaram),
 * mas o corpo nunca terminou de ser lido. `generateOrderOtp` lia esse corpo SEM
 * prazo — `.catch` trata rejeição, não promessa pendente —, então nunca chegava
 * ao `return false`, `OrderSearch` não alcançava o `finally` e o botão ficava em
 * "Gerando Código..." desabilitado até a cliente recarregar o app.
 *
 * Estourou o prazo de leitura = corpo desconhecido (`null`): o aviso de "não
 * conseguimos enviar" já foi mostrado e NENHUMA falha é lembrada (só o corpo
 * dizendo `envio_falhou` grava). A memória de falha não é lida direto (é uma
 * ref interna): prova-se pela frase da tentativa seguinte, que cai no freio de
 * 60 s ("muito_recente") — "Ainda não conseguimos" = falha lembrada; "Já
 * enviamos" = nada lembrado.
 *
 * O hook se alcança por um componente-sonda (sem @testing-library/react) e o
 * import de `@/hooks/useOrders` é dinâmico por causa do `vi.mock` içado.
 */
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const rpc = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ data: [], error: null }) }),
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Gerar = (e: string, w: string, f: string) => Promise<boolean>;

let host: HTMLDivElement;
let raiz: Root;

async function pegarGenerateOrderOtp(): Promise<Gerar> {
  const { useOrders } = await import("@/hooks/useOrders");
  function Sonda({ aoMontar }: { aoMontar: (g: Gerar) => void }) {
    const { generateOrderOtp } = useOrders(false, false);
    useEffect(() => {
      aoMontar(generateOrderOtp);
    }, [generateOrderOtp, aoMontar]);
    return null;
  }
  let gerar: Gerar | undefined;
  await act(async () => {
    raiz.render(
      <Sonda
        aoMontar={(g) => {
          gerar = g;
        }}
      />,
    );
  });
  if (!gerar) throw new Error("a sonda não expôs generateOrderOtp");
  return gerar;
}

/** Passa o tempo dentro de `act`: o hook atualiza estado ao resolver. */
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const EMAIL = "cliente@exemplo.test";
const WHATSAPP = "34999990000";
const FRAGMENTO = "abc123";

/** O erro HTTP real: `invoke` descarta o corpo e entrega `error.context`. */
const erroHttp = (lerCorpo: () => Promise<unknown>) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status"), {
    context: { json: lerCorpo, status: 502 },
  }),
});

const MUITO_RECENTE = {
  data: { ok: false, motivo: "muito_recente", espereSegundos: 42 },
  error: null,
};

const textoDoUltimoToast = () =>
  String(toastError.mock.calls[toastError.mock.calls.length - 1][0]);

describe("generateOrderOtp — corpo do erro HTTP pendurado não prende o botão", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("corpo que nunca termina: depois de 5 s devolve false, avisa UMA vez e não lembra falha", async () => {
    invoke.mockResolvedValueOnce(erroHttp(() => new Promise<never>(() => {})));
    invoke.mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    let resultado: boolean | undefined;
    const espera = gerar(EMAIL, WHATSAPP, FRAGMENTO).then((r) => {
      resultado = r;
    });

    // Dentro do prazo de leitura: segue esperando (o botão ainda está preso).
    await avancar(4_999);
    expect(resultado).toBeUndefined();

    await avancar(1);
    // Confere ANTES de aguardar `espera`: sem a correção ela nunca resolve e o
    // teste falharia por tempo esgotado (60 s), não por esta asserção.
    expect(resultado).toBe(false);
    await espera;

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toContain(
      "Não conseguimos enviar",
    );
    expect(toastSuccess).not.toHaveBeenCalled();

    // Nada foi gravado em `falhasDoOtpRef`: a tentativa seguinte, barrada pelo
    // freio de 60 s, recebe a frase comum — e não a de "falha lembrada".
    expect(await gerar(EMAIL, WHATSAPP, FRAGMENTO)).toBe(false);
    expect(textoDoUltimoToast()).toContain("Já enviamos um código há pouco");
    expect(textoDoUltimoToast()).not.toContain("Ainda não conseguimos");
  });

  it("limite: corpo lento mas que termina ANTES do prazo (4 s) ainda grava a falha, como sempre", async () => {
    invoke.mockResolvedValueOnce(
      erroHttp(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ ok: false, motivo: "envio_falhou" }),
              4_000,
            ),
          ),
      ),
    );
    invoke.mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    const espera = gerar(EMAIL, WHATSAPP, FRAGMENTO);
    await avancar(4_000);
    expect(await espera).toBe(false);

    expect(await gerar(EMAIL, WHATSAPP, FRAGMENTO)).toBe(false);
    expect(textoDoUltimoToast()).toContain("Ainda não conseguimos enviar");
  });

  it("controle: corpo legível com motivo 'envio_falhou' grava a falha (a frase seguinte muda)", async () => {
    invoke
      .mockResolvedValueOnce(
        erroHttp(async () => ({ ok: false, motivo: "envio_falhou" })),
      )
      .mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar(EMAIL, WHATSAPP, FRAGMENTO)).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(await gerar(EMAIL, WHATSAPP, FRAGMENTO)).toBe(false);

    expect(textoDoUltimoToast()).toContain("Ainda não conseguimos enviar");
    expect(textoDoUltimoToast()).not.toMatch(/já enviamos|caixa de entrada/i);
  });

  it("controle: corpo legível SEM esse motivo não grava a falha", async () => {
    invoke
      .mockResolvedValueOnce(
        erroHttp(async () => ({ ok: false, motivo: "sem_remetente" })),
      )
      .mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar(EMAIL, WHATSAPP, FRAGMENTO)).toBe(false);
    expect(await gerar(EMAIL, WHATSAPP, FRAGMENTO)).toBe(false);

    expect(textoDoUltimoToast()).toContain("Já enviamos um código há pouco");
  });

  it("controle: corpo que rejeita (não é JSON) segue devolvendo false sem gravar falha", async () => {
    invoke
      .mockResolvedValueOnce(
        erroHttp(() => Promise.reject(new SyntaxError("Unexpected token <"))),
      )
      .mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar(EMAIL, WHATSAPP, FRAGMENTO)).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(await gerar(EMAIL, WHATSAPP, FRAGMENTO)).toBe(false);

    expect(textoDoUltimoToast()).toContain("Já enviamos um código há pouco");
  });
});
