// @vitest-environment jsdom
//
// R29: no celular o Sonner some (index.css) e a cápsula do topo é o ÚNICO
// aviso. O "Desfazer" de "Produto removido do carrinho" e "Removido dos
// favoritos" é a `action` do toast do Sonner, e a cápsula não tinha botão de
// ação: quem tirava um item sem querer no celular não via como desfazer.
// Aqui: o interceptador leva a ação até a cápsula, a cápsula mostra um botão
// de verdade (alvo de 44 px, fora do botão que dispensa), clicar roda a ação
// UMA vez e fecha o aviso; aviso sem ação segue sendo um botão só.
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: sonner }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "LOJA DA PROVA" } }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

import {
  dispensarToastDoHeader,
  initHeaderToastInterceptor,
} from "@/utils/headerToast";

// @ts-expect-error flag interna do React, mesmo padrão de header-center-slot.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Header — Desfazer na cápsula do celular", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: consulta === "(max-width: 640px)",
      media: consulta,
      // o framer-motion assina `prefers-reduced-motion` por aqui
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    initHeaderToastInterceptor();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(
        <StrictMode>
          <Header onNavigate={() => {}} />
        </StrictMode>,
      );
    });
  });

  afterEach(() => {
    act(() => dispensarToastDoHeader());
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const botaoCom = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );

  async function esperarBotao(texto: string) {
    for (let i = 0; i < 30; i++) {
      const achado = botaoCom(texto);
      if (achado) return achado;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    return undefined;
  }

  // A cápsula sai com animação de saída: espera o texto sumir de verdade.
  async function esperarSumir(texto: string) {
    for (let i = 0; i < 30; i++) {
      if (!hospedeiro.textContent?.includes(texto)) return true;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    return false;
  }

  it.each([
    ["carrinho (toast.info)", "info", "Produto removido do carrinho"],
    ["favoritos (toast.success)", "success", "Removido dos favoritos"],
  ] as const)(
    "%s: o botão Desfazer aparece na cápsula, roda a ação uma vez e fecha o aviso",
    async (_nome, metodo, mensagem) => {
      const { toast } = await import("sonner");
      const aoDesfazer = vi.fn();
      const avisar = metodo === "info" ? toast.info : toast.success;
      act(() => {
        avisar(mensagem, {
          duration: 60_000,
          action: { label: "Desfazer", onClick: aoDesfazer },
        });
      });

      const desfazer = await esperarBotao("Desfazer");
      expect(desfazer).toBeDefined();
      // botão de verdade, nunca dentro de outro botão (HTML inválido)
      expect(desfazer!.parentElement!.closest("button")).toBeNull();
      // alvo de toque de pelo menos 44 px
      expect(desfazer!.className).toContain("min-h-11");
      expect(desfazer!.className).toContain("min-w-11");
      // o texto do aviso segue na cápsula e continua dispensando
      expect(botaoCom(mensagem)).toBeDefined();

      await act(async () => {
        desfazer!.click();
      });

      expect(aoDesfazer).toHaveBeenCalledTimes(1);
      expect(await esperarSumir(mensagem)).toBe(true);
    },
  );

  it.each([
    ["erro", "error", "Não deu para desfazer: o carrinho mudou."],
    ["info", "info", "Este produto está esgotado."],
  ] as const)(
    "o Desfazer que falha avisa (%s) NO MESMO toque e o aviso novo não é apagado",
    async (_nome, metodo, falha) => {
      const { toast } = await import("sonner");
      // Como `restaurarLinhaRemovida`: dentro do clique, avisa por que não deu.
      const aoDesfazer = vi.fn(() => {
        if (metodo === "error") toast.error(falha, { duration: 60_000 });
        else toast.info(falha, { duration: 60_000 });
      });
      act(() => {
        toast.info("Produto removido do carrinho", {
          duration: 60_000,
          action: { label: "Desfazer", onClick: aoDesfazer },
        });
      });
      const desfazer = await esperarBotao("Desfazer");
      await act(async () => {
        desfazer!.click();
      });
      expect(aoDesfazer).toHaveBeenCalledTimes(1);
      expect(await esperarBotao(falha)).toBeDefined();
      expect(hospedeiro.textContent).toContain(falha);
    },
  );

  it("tocar no texto do aviso com ação só dispensa: não desfaz", async () => {
    const { toast } = await import("sonner");
    const aoDesfazer = vi.fn();
    act(() => {
      toast.info("Produto removido do carrinho", {
        duration: 60_000,
        action: { label: "Desfazer", onClick: aoDesfazer },
      });
    });
    const texto = await esperarBotao("Produto removido do carrinho");
    await act(async () => {
      texto!.click();
    });
    expect(aoDesfazer).not.toHaveBeenCalled();
    expect(await esperarSumir("Produto removido")).toBe(true);
  });

  it("aviso sem ação continua sendo UM botão só, sem Desfazer", async () => {
    const { toast } = await import("sonner");
    act(() => {
      toast.info("Salvo", { duration: 60_000 });
    });
    const cap = await esperarBotao("Salvo");
    expect(cap).toBeDefined();
    expect(cap!.querySelector("button")).toBeNull();
    expect(botaoCom("Desfazer")).toBeUndefined();
  });

  it("ação sem rótulo em texto ou sem função é ignorada, sem quebrar", async () => {
    const { toast } = await import("sonner");
    act(() => {
      toast.info("Aviso com ação torta", {
        duration: 60_000,
        action: { label: <b>x</b>, onClick: vi.fn() },
      });
    });
    const cap = await esperarBotao("Aviso com ação torta");
    expect(cap).toBeDefined();
    expect(cap!.querySelector("button")).toBeNull();
  });
});
