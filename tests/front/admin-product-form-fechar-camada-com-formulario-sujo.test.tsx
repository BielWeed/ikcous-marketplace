// @vitest-environment jsdom
//
// Defeito achado na revisao: com o formulario do produto JA MEXIDO (sujo), fechar
// a previa/recorte/leitor/ajuda pelo botao da propria janela abria o aviso
// "Alteracoes nao salvas" -- e o botao "Descartar e sair" apaga o rascunho.
//
// Causa: ao fechar, a tela devolve a entrada de historico com `history.back()`
// (o `popstate` chega DEPOIS) e, no mesmo ciclo, zerava o desvio do Voltar. O
// App zera o ref do desvio no commit; quando o `popstate` chegava nao havia mais
// desvio e o formulario sujo caia na trava do "sujo".
//
// O teste antigo (`admin-product-form-voltar-fecha-so-a-camada`) so simula
// `onSetBackOverride` e nao tem o tratamento do `popstate` do App, por isso nao
// via isso. Aqui o hospedeiro REPRODUZ a semantica do App: o desvio mora num ref
// atualizado num `useLayoutEffect`, o `popstate` e real (jsdom) e, sem desvio e
// com o formulario sujo, ele marca que o aviso de descartar abriria.
import {
  act,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ComponentType, ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(true),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn(),
    fetchProduct: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/components/admin/PhoneSimulator", () => ({
  PhoneSimulator: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="previa">
      <button type="button" onClick={onClose}>
        Fechar prévia
      </button>
    </div>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const botaoPorTexto = (texto: string) =>
  [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;

const esperar = (ms = 40) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// O que o App faz com o Voltar, na parte que importa aqui.
const placar = {
  // Quantos `popstate` chegaram.
  popstates: 0,
  // O App abriria o aviso "Alteracoes nao salvas" (e empurraria historico).
  pendenteDeDescarte: false,
  // O desvio vigente (o que o App guardaria em `backOverrideRef`).
  desvioVigente: null as (() => void) | null,
  sujo: false,
  // Tira a tela do cadastro de cena (o App continua de pe).
  sairDaTela: null as (() => void) | null,
};

let desmontarHospedeiro: (() => void) | null = null;

type PropsDaTela = {
  userId: string;
  onNavigate: () => void;
  onSetDirty: (sujo: boolean) => void;
  onSetBackOverride: (fn: (() => void) | null) => void;
};

function HospedeiroDoApp({ Tela }: { Tela: ComponentType<PropsDaTela> }) {
  const [desvio, setDesvio] = useState<(() => void) | null>(null);
  const [telaNaCena, setTelaNaCena] = useState(true);
  const desvioRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    placar.sairDaTela = () => setTelaNaCena(false);
  }, []);
  // Igual ao App: o ref do desvio e atualizado no commit.
  useLayoutEffect(() => {
    desvioRef.current = desvio;
    placar.desvioVigente = desvio;
  }, [desvio]);
  const aoSujar = useCallback((sujo: boolean) => {
    placar.sujo = sujo;
  }, []);
  useEffect(() => {
    const aoVoltar = () => {
      placar.popstates += 1;
      if (desvioRef.current) {
        desvioRef.current();
        return;
      }
      if (placar.sujo) placar.pendenteDeDescarte = true;
    };
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, []);
  if (!telaNaCena) return null;
  return (
    <Tela
      userId="u-teste"
      onNavigate={vi.fn()}
      onSetDirty={aoSujar}
      onSetBackOverride={setDesvio}
    />
  );
}

describe("AdminProductFormView — fechar a camada com o formulario ja mexido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    placar.popstates = 0;
    placar.pendenteDeDescarte = false;
    placar.desvioVigente = null;
    placar.sujo = false;
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    window.history.replaceState(
      { view: "admin-product-form" },
      "",
      "/admin-product-form",
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    desmontarHospedeiro = () => {
      act(() => {
        raiz.unmount();
      });
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    if (desmontarHospedeiro) {
      desmontarHospedeiro();
      desmontarHospedeiro = null;
    }
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montarSujo() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(<HospedeiroDoApp Tela={AdminProductFormView} />);
    });
    await esperar();
    await act(async () => {
      digitar("product-name", "Camiseta mexida");
      // O campo entrega o texto ao formulario depois de uma pausa curta.
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(placar.sujo).toBe(true);
  }

  const previaAberta = () =>
    document.querySelector('[data-testid="previa"]') !== null;

  const abrirPrevia = async () => {
    await act(async () => {
      botaoPorTexto("Ver app")?.click();
    });
  };
  const fecharPeloBotao = async () => {
    await act(async () => {
      botaoPorTexto("Fechar prévia")?.click();
    });
  };

  it("fechar a previa pelo botao, com o formulario sujo, NAO abre o aviso de descartar", async () => {
    await montarSujo();
    await abrirPrevia();
    expect(previaAberta()).toBe(true);
    expect(window.history.state).toMatchObject({ modal: "produto" });

    await fecharPeloBotao();
    await esperar();

    expect(previaAberta()).toBe(false);
    // O navegador devolveu a entrada da camada (o popstate chegou)...
    expect(placar.popstates).toBe(1);
    // ...e o App nao viu isso como "sair do cadastro com alteracao".
    expect(placar.pendenteDeDescarte).toBe(false);
    expect(window.history.state?.modal).toBeUndefined();
    // O formulario continua la, com o que ela digitou.
    expect(
      (document.getElementById("product-name") as HTMLInputElement).value,
    ).toBe("Camiseta mexida");
    // O desvio do Voltar se desfez sozinho (nao fica preso).
    expect(placar.desvioVigente).toBeNull();
  });

  it("Voltar fisico com a previa aberta fecha so a camada e nao abre o aviso", async () => {
    await montarSujo();
    await abrirPrevia();

    // O botao Voltar do aparelho: o navegador tira a entrada e avisa o App.
    await act(async () => {
      window.history.back();
    });
    await esperar();

    expect(previaAberta()).toBe(false);
    expect(placar.popstates).toBe(1);
    expect(placar.pendenteDeDescarte).toBe(false);
    expect(document.getElementById("product-name")).not.toBeNull();
    expect(placar.desvioVigente).toBeNull();
  });

  it("abrir e fechar a previa duas vezes seguidas continua sem aviso", async () => {
    await montarSujo();

    await abrirPrevia();
    await fecharPeloBotao();
    await esperar();
    await abrirPrevia();
    await fecharPeloBotao();
    await esperar();

    expect(previaAberta()).toBe(false);
    expect(placar.popstates).toBe(2);
    expect(placar.pendenteDeDescarte).toBe(false);
    expect(placar.desvioVigente).toBeNull();
  });

  it("reabrir antes do popstate chegar: o desvio vigente e o da camada nova, nao o que engole", async () => {
    await montarSujo();
    await abrirPrevia();
    await fecharPeloBotao();
    // Reabre ANTES do popstate da primeira devolucao chegar.
    await abrirPrevia();
    expect(previaAberta()).toBe(true);
    expect(placar.desvioVigente).toBeInstanceOf(Function);
    await esperar();

    // Seja qual for a ordem em que o navegador entregou as entradas, nunca abre
    // o aviso de descartar nem deixa um desvio de uso unico preso.
    expect(placar.pendenteDeDescarte).toBe(false);
    if (previaAberta()) {
      // A camada nova segue de pe: o Voltar dela fecha so ela.
      expect(placar.desvioVigente).toBeInstanceOf(Function);
      await act(async () => {
        window.history.back();
      });
      await esperar();
      expect(previaAberta()).toBe(false);
    }
    // Deixa chegar o que ainda estiver a caminho (a devolucao da entrada que
    // sobrou) antes de conferir o fim.
    // O contrato é "acaba zerado": em máquina lenta (CI) o popstate da segunda
    // devolução chega depois de 100 ms, e a rede de segurança (1,5 s) cobre o
    // resto. Por isso espera até zerar, com folga acima do prazo da rede.
    await vi.waitFor(
      () => {
        expect(placar.desvioVigente).toBeNull();
      },
      { timeout: 4000, interval: 50 },
    );
    expect(placar.pendenteDeDescarte).toBe(false);
  });

  it("rede de seguranca: se o popstate nunca chegar, o desvio que engole se desfaz sozinho", async () => {
    await montarSujo();
    await abrirPrevia();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // O navegador "perde" a volta: nenhum popstate.
    vi.spyOn(window.history, "back").mockImplementation(() => {});

    await fecharPeloBotao();
    expect(previaAberta()).toBe(false);
    // Ate o popstate chegar, o App ainda tem um desvio (o que engole).
    expect(placar.desvioVigente).toBeInstanceOf(Function);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Passou o prazo: nao fica preso para engolir um Voltar FUTURO.
    expect(placar.desvioVigente).toBeNull();
  });

  it("sair da tela com o desvio de uso unico ainda pendente zera o desvio", async () => {
    await montarSujo();
    await abrirPrevia();
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    await fecharPeloBotao();
    expect(placar.desvioVigente).toBeInstanceOf(Function);

    await act(async () => {
      placar.sairDaTela?.();
    });

    expect(placar.desvioVigente).toBeNull();
  });
});
