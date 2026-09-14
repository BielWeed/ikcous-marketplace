// @vitest-environment jsdom
//
// CONTRATO DE CAMADA (peça 03, 13/09 — defeito 1): overlay e conteúdo do
// Sheet têm de pintar ACIMA do chrome fixo do app. Medição headless (CDP)
// provou o defeito no celular: a BottomNav é fixed z-[120] (faixa y779-844,
// wrapper com pointer-events:none, bg-white/95) e o Sheet padrão shadcn
// pintava overlay+content em z-50 — o RODAPÉ da folha de opções do card
// (com o CTA "Adicionar") ficava inteiro atrás da barra de navegação, e o
// véu não escurecia a nav (ela aparecia NÍTIDA por cima do overlay, a
// assinatura do defeito nos prints do dono). Doença sistêmica: todo overlay
// shadcn (sheet/dialog/alert-dialog) pintava atrás do chrome fixo; este
// conserto cobre os sheets (a folha do card e os filtros da busca, de
// graça); dialog/alert-dialog seguem latentes (aviso no PR da peça).
//
// jsdom NÃO pinta z-index — este teste ancora o CONTRATO DE CLASSE: o mesmo
// degrau z-[130] no overlay E no content (régua da casa: header 100 <
// BottomNav 120 < sheet modal 130 — degrau que o ImageAdjuster já usava —
// < barra de progresso 99999). Os DOIS juntos, sempre: overlay sem content
// deixa a nav nítida sobre a folha; content sem overlay deixa a nav clicável
// por cima do véu. A prova visual de verdade é o headless pós-conserto +
// revisão (registrada no PR).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Sheet — pinta acima do chrome fixo (z-[130] no overlay e no content)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("overlay e content carregam o degrau z-[130] (acima da BottomNav z-[120])", async () => {
    await act(async () => {
      raiz.render(
        <Sheet open onOpenChange={() => {}}>
          <SheetContent side="bottom" data-testid="folha-de-teste">
            <SheetTitle>Folha</SheetTitle>
            <SheetDescription>Contrato de camada.</SheetDescription>
          </SheetContent>
        </Sheet>,
      );
    });

    const overlay = document.querySelector('[data-slot="sheet-overlay"]');
    const content = document.querySelector('[data-slot="sheet-content"]');
    expect(overlay).not.toBeNull();
    expect(content).not.toBeNull();
    expect(overlay?.className).toContain("z-[130]");
    expect(content?.className).toContain("z-[130]");
    // E não sobrou o z-50 antigo em nenhum dos dois (se um deles ficar no
    // degrau velho, o defeito volta em metade da tela).
    expect(overlay?.className).not.toContain("z-50 ");
    expect(content?.className).not.toContain("z-50 ");
  });
});

// ── O canal de toast do celular limpa o degrau do modal ──────────────────
// Achado da revisão da peça 03 (14/09): no celular o toaster flutuante do
// sonner é display:none (index.css) e TODO aviso (warning/error) mora na
// cápsula que expande no Header — que é z-[100], ATRÁS do véu z-[130] do
// Sheet. Com a folha de opções aberta, o "Falta escolher" (disparado pela
// própria folha, que não fecha sozinha) pintava escurecido por baixo do véu,
// e tocar na cápsula para dispensar acertava o OVERLAY e fechava a FOLHA —
// regressão de coisa que funcionava (a ilha z-100 era nítida sobre o véu
// z-50 antigo). O contrato: ENQUANTO um toast está ativo, o header sobe um
// degrau ACIMA do sheet modal (régua: header 100/140-durante-toast < nav
// 120 < modal 130 < progresso 99999) — transitório (a cápsula dura ~2,6 s),
// sem tocar na morfologia dela nem tornar o header clicável sobre a folha
// fora da janela do aviso.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { logoUrl: null, storeName: "Loja" } }),
}));

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCartState: () => ({ cartCount: 0 }),
}));

vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

import { Header } from "@/components/ui/custom/Header";

describe("Header — o toast ativo limpa o degrau do sheet modal (z-[140])", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    act(() => {
      raiz.render(<Header onNavigate={() => {}} />);
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("sem toast, o header segue no degrau do chrome (z-[100])", () => {
    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    expect(header?.className).toContain("z-[100]");
    expect(header?.className).not.toContain("z-[140]");
  });

  it("com toast ativo, o header sobe para z-[140] e a cápsula está no DOM", async () => {
    await act(async () => {
      globalThis.dispatchEvent(
        new CustomEvent("header-toast-event", {
          detail: {
            id: "teste-falta-escolher",
            message: "Falta escolher a opção de Cor",
            type: "warning",
          },
        }),
      );
    });

    const header = document.querySelector("header");
    expect(header?.className).toContain("z-[140]");
    expect(header?.className).not.toContain("z-[100]");

    // O canal em si está ativo: a cápsula clicável carrega a mensagem.
    const capsula = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Falta escolher"),
    );
    expect(capsula).toBeDefined();
  });
});
