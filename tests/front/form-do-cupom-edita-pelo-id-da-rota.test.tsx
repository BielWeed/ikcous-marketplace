// @vitest-environment jsdom
//
// Laudo 0109 (A4 + A5) — o form de cupom tinha dois defeitos que se
// alimentavam:
//
// A4: a decisão editar×criar MORAVA na lista carregada (`coupons.find`).
// Deep-link de edição com o fetch falhado → salvamento virava INSERT → a
// constraint `coupons_code_key` recusava → trocando o código para
// "destravar" nascia um SEGUNDO cupom com o antigo vivo. A decisão agora é
// pelo `couponId` da rota, e cupom que não carregou NÃO salva (nem INSERT,
// nem UPDATE cego por cima com os zeros de partida).
//
// A5: o efeito de inicialização rodava de novo a cada mudança de `coupons`
// e fazia `setFormData(data)` sem guarda — digitar rápido com rede de
// celular era apagado quando a resposta chegava. Agora inicializa UMA vez
// por cupom e o que o lojista já digitou VENCE; o resto vem do banco.
//
// Molde de montagem: tests/front/admin-banners-duplicar-removido-nao-apaga-
// imagem-alheia.test.tsx (createRoot + act, hooks dublês com estado mutável
// fora do módulo — é o que permite encenar "a carga chegou depois").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

const addCoupon = vi.fn();
const updateCoupon = vi.fn();
const onNavigate = vi.fn();

// Estado mutável de propósito: é ele que encena o fetch chegando DEPOIS do
// lojista começar a digitar.
let estadoCoupons: {
  coupons: Record<string, unknown>[];
  loading: boolean;
} = { coupons: [], loading: true };

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ ...estadoCoupons, addCoupon, updateCoupon }),
}));

const cupomReal = {
  id: "cupom-1",
  code: "NATAL",
  type: "percentage",
  value: 25,
  minPurchase: 50,
  usageLimit: 10,
  validUntil: null,
  active: true,
  usageCount: 0,
};

let container: HTMLElement | null = null;
let root: Root | null = null;

async function montar(couponId?: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <AdminCouponFormView
        couponId={couponId}
        onNavigate={onNavigate}
        onSetDirty={() => {}}
      />,
    );
  });
  await act(async () => {});
}

async function redimir() {
  await act(async () => {
    root?.render(
      <AdminCouponFormView
        couponId="cupom-1"
        onNavigate={onNavigate}
        onSetDirty={() => {}}
      />,
    );
  });
  await act(async () => {});
}

function acharBotao(texto: string): HTMLButtonElement | null {
  const botoes = container?.querySelectorAll("button") || [];
  for (const botao of botoes) {
    if (botao.textContent?.trim() === texto) return botao;
  }
  return null;
}

async function digitarCampo(seletor: string, valor: string) {
  const input = container?.querySelector(seletor);
  if (!input) throw new Error(`campo ${seletor} não encontrado`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // O LocalBufferedInput só repassa ao form depois da janela de debounce.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
}

const digitarCodigo = (valor: string) => digitarCampo("#coupon-code", valor);
// A validação do form recusa desconto 0 ANTES do portão do A4 — sem um
// valor digitado, o teste nunca chega onde quer provar.
const digitarValor = (valor: string) => digitarCampo("#coupon-value", valor);

beforeEach(() => {
  toastError.mockClear();
  addCoupon.mockReset();
  updateCoupon.mockReset();
  onNavigate.mockClear();
  estadoCoupons = { coupons: [], loading: true };
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe("form de cupom — A4: a decisão é do couponId da rota", () => {
  it("cupom da rota que o fetch não trouxe NÃO vira INSERT", async () => {
    estadoCoupons = { coupons: [], loading: false };
    await montar("cupom-1");
    await digitarCodigo("NATAL");
    await digitarValor("15");

    await act(async () => {
      acharBotao("Salvar Cupom")?.click();
    });

    expect(addCoupon).not.toHaveBeenCalled();
    expect(updateCoupon).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Recarregue a página"),
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("carga ainda em andamento pede espera, não salva cego", async () => {
    estadoCoupons = { coupons: [], loading: true };
    await montar("cupom-1");
    await digitarCodigo("NATAL");
    await digitarValor("15");

    await act(async () => {
      acharBotao("Salvar Cupom")?.click();
    });

    expect(addCoupon).not.toHaveBeenCalled();
    expect(updateCoupon).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("ainda estão carregando"),
    );
  });

  it("couponId na rota + cupom carregado → updateCoupon, nunca addCoupon", async () => {
    estadoCoupons = { coupons: [cupomReal], loading: false };
    await montar("cupom-1");
    updateCoupon.mockResolvedValue(undefined);

    await act(async () => {
      acharBotao("Salvar Cupom")?.click();
    });

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][0]).toBe("cupom-1");
    expect(addCoupon).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("admin-coupons");
  });
});

describe("form de cupom — A5: a chegada tardia da carga não apaga o digitado", () => {
  it("mescla: o que o lojista digitou vence, o resto vem do banco", async () => {
    await montar("cupom-1");

    // O lojista muda o tipo para R$ (fixo) com a carga ainda em voo —
    // formulário sujo, estado de partida.
    await act(async () => {
      acharBotao("R$")?.click();
    });

    // A resposta do fetch chega: cupom REAL é percentual, R$ 25, mínimo 50,
    // limite 10. O tipo digitado tem que sobreviver; o resto tem que ENCHER
    // (o form antigo ficaria nos zeros de partida ou apagaria tudo).
    estadoCoupons = { coupons: [cupomReal], loading: false };
    await redimir();

    updateCoupon.mockResolvedValue(undefined);
    await act(async () => {
      acharBotao("Salvar Cupom")?.click();
    });

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    const [, enviado] = updateCoupon.mock.calls[0];
    expect(enviado.type).toBe("fixed");
    expect(Number(enviado.value)).toBe(25);
    expect(Number(enviado.minPurchase)).toBe(50);
    expect(Number(enviado.usageLimit)).toBe(10);
    expect(enviado.code).toBe("NATAL");
  });

  it("depois de inicializado, refetch nenhum re-inicializa o form", async () => {
    estadoCoupons = { coupons: [cupomReal], loading: false };
    await montar("cupom-1");
    await digitarCodigo("NATAL2026");

    // Refetch pós-salvamento traz uma ARRAY NOVA com o MESMO cupom — era
    // exatamente isto que re-corria o efeito antigo e apagava o código.
    estadoCoupons = {
      coupons: [{ ...cupomReal, code: "NATAL" }],
      loading: false,
    };
    await redimir();

    updateCoupon.mockResolvedValue(undefined);
    await act(async () => {
      acharBotao("Salvar Cupom")?.click();
    });

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon.mock.calls[0][1].code).toBe("NATAL2026");
  });
});
