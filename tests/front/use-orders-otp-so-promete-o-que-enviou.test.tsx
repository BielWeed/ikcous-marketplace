// @vitest-environment jsdom
/**
 * `generateOrderOtp` depois da inversão (#161 + #86).
 *
 * O que se prova aqui é a TRADUÇÃO: a resposta HTTP da edge function vira um
 * booleano e uma mensagem. Antes desta mudança a função chamava a RPC e
 * devolvia `true` assim que a validação passava — muito antes de qualquer
 * e-mail existir. É esse `true` prematuro que a tela usava para escrever
 * "código de verificação enviado".
 *
 * Este projeto NÃO tem @testing-library/react (conferido no package.json em
 * 19/08/2026): os testes de front daqui montam com react-dom/client puro. Por
 * isso o hook se alcança por um componente-sonda, que só expõe a função.
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
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
      select: () => ({ eq: () => ({ order: () => ({ data: [], error: null }) }) }),
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
// O hook chama estes dois no corpo; sem eles a sonda não monta.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

type Gerar = (e: string, w: string, f: string) => Promise<boolean>;

let host: HTMLDivElement;
let raiz: Root;

/**
 * Duas restrições se cruzam aqui, e é por isso que a sonda tem esta forma:
 *
 * 1. O import de `@/hooks/useOrders` tem de ser DINÂMICO. `vi.mock` é içado
 *    para o topo do arquivo, então um import estático faria a fábrica do mock
 *    rodar antes de `const invoke = vi.fn()` existir — e o vitest morre com
 *    "Cannot access 'invoke' before initialization", sem coletar teste nenhum.
 * 2. A função tem de sair por um EFEITO, e não por atribuição a uma variável
 *    de fora durante a renderização: isso é efeito colateral em render, e a
 *    regra `react-hooks/globals` do projeto reprova — com razão.
 */
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

describe("generateOrderOtp — o retorno segue o envio, não a validação", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  it("chama a edge function, e NÃO a RPC", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const gerar = await pegarGenerateOrderOtp();
    await gerar("a@b.c", "34999999999", "abcdef");

    expect(invoke).toHaveBeenCalledWith("send-otp-email", {
      body: { email: "a@b.c", whatsapp: "34999999999", orderFragment: "abcdef" },
    });
    // A RPC continua existindo no banco, mas esta tela não a chama mais.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("enviou: devolve true", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const gerar = await pegarGenerateOrderOtp();
    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(true);
  });

  it("envio falhou: devolve false e avisa que a loja não conseguiu enviar", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, motivo: "envio_falhou" },
      error: null,
    });
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(String(toastError.mock.calls[0][0])).toContain(
      "Não conseguimos enviar",
    );
  });

  it("loja sem remetente configurado: também é falha de envio, não culpa de quem compra", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, motivo: "sem_remetente" },
      error: null,
    });
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(String(toastError.mock.calls[0][0])).toContain(
      "Não conseguimos enviar",
    );
  });

  it("dados não conferem: mensagem única, sem dizer qual metade errou", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, motivo: "nao_confere" },
      error: null,
    });
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    // Distinguir "pedido não existe" de "e-mail não bate" diria a quem está
    // adivinhando qual metade ele já acertou (AUTH-010, #118).
    expect(String(toastError.mock.calls[0][0])).toContain(
      "e-mail, WhatsApp e ID juntos",
    );
  });

  it("pedido repetido cedo demais: diz quantos segundos esperar", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, motivo: "muito_recente", espereSegundos: 42 },
      error: null,
    });
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(String(toastError.mock.calls[0][0])).toContain("42");
  });

  it("a função nem respondeu (rede caiu): devolve false, nunca true", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new Error("Failed to fetch"),
    });
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("invoke lançou exceção: devolve false, nunca true", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
