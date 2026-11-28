// @vitest-environment jsdom
//
// Achado da caça (27/11/2026): com uma folha aberta, o que FLUTUA POR CIMA
// dela — a cápsula de aviso do topo (Header, wrapper que sobe para z-140 com
// aviso ativo), a ilha de atualização e o aviso do Sonner do painel ("Novo
// pedido recebido! — Ver", z 99999) — era lido como "toque fora da folha".
// Tocar em "Ver" ou no próprio aviso FECHAVA a folha por baixo (a cliente
// perdia o que estava preenchendo) e a ação do aviso nem rodava.
//
// Dois mecanismos, os dois consertados:
//   1. navegador de verdade: com a folha modal aberta o Radix grava
//      `pointer-events: none` no <body>; o aviso HERDA isso e o dedo cai no
//      véu (pointer-events: auto) — fecha. Conserto em CSS (index.css):
//      quem é camada flutuante volta a receber o toque. O jsdom não faz
//      hit-test, então aqui o contrato do CSS se prova por leitura.
//   2. o aviso recebendo o toque: o Radix (pointerdown fora) e o guardião
//      do clique pós-fecho da `ui/sheet` tratavam o gesto como "fora" —
//      fechavam a folha e engoliam o click. Isto se prova com o gesto
//      INTEIRO (pointerdown → pointerup → click, toque e mouse).
// Controles: tocar no véu e apertar Esc seguem fechando.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { readFileSync } from "node:fs";
import { type ReactNode, act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "LOJA DA PROVA" } }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));
// O tempo de saída do Framer não é o assunto: a cápsula some na hora.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}));

import { BarraSuperiorCliente } from "@/components/ui/custom/BarraSuperiorCliente";
import { Header } from "@/components/ui/custom/Header";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { definirEstadoDaAtualizacao } from "@/lib/atualizacao/estado-da-atualizacao";
import {
  dispensarToastDoHeader,
  initHeaderToastInterceptor,
} from "@/utils/headerToast";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Ponteiro = "touch" | "mouse";

class ResizeObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function eventoDePonteiro(tipo: string, ponteiro: Ponteiro): Event {
  // O jsdom não tem PointerEvent: o MouseEvent com o `pointerType` colado é o
  // que o Radix e o guardião da folha leem.
  const evento = new MouseEvent(tipo, {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  Object.defineProperty(evento, "pointerType", { value: ponteiro });
  Object.defineProperty(evento, "pointerId", { value: 1 });
  return evento;
}

/** O gesto inteiro de um toque (ou clique) no `alvo`, como o aparelho manda. */
async function tocar(alvo: Element, ponteiro: Ponteiro) {
  await act(async () => {
    alvo.dispatchEvent(eventoDePonteiro("pointerdown", ponteiro));
    alvo.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    alvo.dispatchEvent(eventoDePonteiro("pointerup", ponteiro));
    alvo.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    alvo.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
  });
}

async function esperar(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function esperarPor<T>(achar: () => T | null | undefined): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const achado = achar();
    if (achado) return achado;
    await esperar(20);
  }
  throw new Error("elemento não apareceu");
}

const folha = () =>
  document.querySelector<HTMLElement>('[data-slot="sheet-content"]');
const veu = () =>
  document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');
const botaoCom = (raiz: ParentNode, texto: string) =>
  [...raiz.querySelectorAll<HTMLElement>("button")].find((b) =>
    b.textContent?.includes(texto),
  );
const cabecalho = () => document.querySelector<HTMLElement>("header");
/** Botão da cápsula do topo (fora do Sonner) com o `texto`. */
const naCapsula = (texto: string) =>
  botaoCom(cabecalho() as HTMLElement, texto);
/** O texto da ilha de atualização no topo (achado pelo que ela diz). */
const ilhaDeAtualizacao = () =>
  [...(cabecalho()?.querySelectorAll<HTMLElement>("span") ?? [])].find(
    (el) => el.children.length === 0 && el.textContent === "Atualizando o app…",
  );
const avisoDoSonner = () =>
  document.querySelector<HTMLElement>("[data-sonner-toast]");

function Cena({ aoMudar }: { readonly aoMudar: (aberta: boolean) => void }) {
  const [aberta, setAberta] = useState(true);
  return (
    <>
      <BarraSuperiorCliente>
        <Header onNavigate={() => {}} />
      </BarraSuperiorCliente>
      <Sheet
        open={aberta}
        onOpenChange={(v) => {
          aoMudar(v);
          setAberta(v);
        }}
      >
        <SheetContent side="bottom">
          <SheetTitle>Endereço de entrega</SheetTitle>
          <SheetDescription>O que a cliente está preenchendo.</SheetDescription>
          <input aria-label="Rua" defaultValue="Rua das Flores" />
        </SheetContent>
      </Sheet>
      <Toaster />
    </>
  );
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const capturaOriginal = Element.prototype.setPointerCapture;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverFalso);
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: consulta === "(max-width: 640px)",
    media: consulta,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  // O Sonner captura o ponteiro no pointerdown do aviso; o jsdom não tem.
  Element.prototype.setPointerCapture = () => {};
  initHeaderToastInterceptor();
  definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  act(() => {
    toast.dismiss();
    dispensarToastDoHeader();
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
  });
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  Element.prototype.setPointerCapture = capturaOriginal;
  vi.unstubAllGlobals();
});

async function montar() {
  const aoMudar = vi.fn();
  act(() => {
    raiz.render(<Cena aoMudar={aoMudar} />);
  });
  // O Radix e o guardião só passam a ouvir o gesto no tique seguinte.
  await esperar();
  expect(folha()).not.toBeNull();
  return aoMudar;
}

/** O aviso "Novo pedido — Ver" do painel: vai ao Sonner E à cápsula do topo. */
async function avisarPedidoNovo(numero: string) {
  const aoVer = vi.fn();
  act(() => {
    toast.info(`Novo pedido recebido! #${numero}`, {
      duration: 60_000,
      action: { label: "Ver", onClick: aoVer },
    });
  });
  await esperarPor(avisoDoSonner);
  await esperarPor(() => naCapsula(`#${numero}`));
  await esperar();
  return aoVer;
}

function folhaSegueAberta(aoMudar: ReturnType<typeof vi.fn>) {
  expect(aoMudar).not.toHaveBeenCalledWith(false);
  expect(folha()).not.toBeNull();
  expect(
    folha()?.querySelector<HTMLInputElement>('input[aria-label="Rua"]')?.value,
  ).toBe("Rua das Flores");
}

describe.each(["touch", "mouse"] as const)(
  "folha aberta com aviso por cima — %s",
  (ponteiro) => {
    it('"Ver" no aviso do Sonner roda a ação e NÃO fecha a folha', async () => {
      const aoMudar = await montar();
      const aoVer = await avisarPedidoNovo("101");
      const ver = botaoCom(avisoDoSonner() as HTMLElement, "Ver");
      expect(ver).toBeDefined();

      await tocar(ver as HTMLElement, ponteiro);
      await esperar();

      expect(aoVer).toHaveBeenCalledTimes(1);
      folhaSegueAberta(aoMudar);
    });

    it("tocar no texto do aviso do Sonner não fecha a folha", async () => {
      const aoMudar = await montar();
      await avisarPedidoNovo("102");
      const titulo = (avisoDoSonner() as HTMLElement).querySelector(
        "[data-title]",
      ) as HTMLElement;
      expect(titulo).not.toBeNull();

      await tocar(titulo, ponteiro);
      await esperar();

      folhaSegueAberta(aoMudar);
    });

    it('"Ver" na cápsula do topo roda a ação e NÃO fecha a folha', async () => {
      const aoMudar = await montar();
      const aoVer = await avisarPedidoNovo("103");
      const ver = naCapsula("Ver");
      expect(ver).toBeDefined();

      await tocar(ver as HTMLElement, ponteiro);
      await esperar();

      expect(aoVer).toHaveBeenCalledTimes(1);
      folhaSegueAberta(aoMudar);
    });

    it("tocar no texto da cápsula dispensa o aviso e NÃO fecha a folha", async () => {
      const aoMudar = await montar();
      await avisarPedidoNovo("104");
      const texto = naCapsula("#104");
      expect(texto).toBeDefined();

      await tocar(texto as HTMLElement, ponteiro);
      await esperar();

      expect(naCapsula("#104")).toBeUndefined(); // o que o toque faz: dispensa
      folhaSegueAberta(aoMudar);
    });

    it("tocar na ilha de atualização não fecha a folha", async () => {
      const aoMudar = await montar();
      act(() => definirEstadoDaAtualizacao({ fase: "instalando" }));
      const ilha = await esperarPor(ilhaDeAtualizacao);
      await esperar();

      await tocar(ilha, ponteiro);
      await esperar();

      folhaSegueAberta(aoMudar);
    });

    // CONTROLE: o conserto não pode tirar o "tocar fora fecha".
    it("tocar no véu continua fechando a folha (com aviso no ar)", async () => {
      const aoMudar = await montar();
      await avisarPedidoNovo("105");

      await tocar(veu() as HTMLElement, ponteiro);
      await esperar();

      expect(aoMudar).toHaveBeenCalledWith(false);
      expect(folha()).toBeNull();
    });
  },
);

describe("controles e contrato", () => {
  it("Esc continua fechando a folha com aviso no ar", async () => {
    const aoMudar = await montar();
    await avisarPedidoNovo("106");

    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await esperar();

    expect(aoMudar).toHaveBeenCalledWith(false);
    expect(folha()).toBeNull();
  });

  it("o gesto que só PASSA pelo aviso mas nasce no véu ainda fecha", async () => {
    // Quem decide é onde o gesto NASCE (pointerdown): soltar o dedo em cima
    // do aviso não transforma um toque no véu em toque no aviso.
    const aoMudar = await montar();
    await avisarPedidoNovo("107");
    const ver = botaoCom(avisoDoSonner() as HTMLElement, "Ver") as HTMLElement;

    await act(async () => {
      (veu() as HTMLElement).dispatchEvent(
        eventoDePonteiro("pointerdown", "touch"),
      );
      ver.dispatchEvent(eventoDePonteiro("pointerup", "touch"));
      (veu() as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await esperar();

    expect(aoMudar).toHaveBeenCalledWith(false);
  });

  it("cápsula e ilha se declaram camada flutuante (o CSS e a folha leem isso)", async () => {
    await montar();
    await avisarPedidoNovo("108");
    expect(
      naCapsula("#108")?.closest("[data-camada-flutuante]"),
    ).not.toBeNull();
    expect(naCapsula("Ver")?.closest("[data-camada-flutuante]")).not.toBeNull();
    act(() => dispensarToastDoHeader());
    act(() => definirEstadoDaAtualizacao({ fase: "instalando" }));
    const ilha = await esperarPor(ilhaDeAtualizacao);
    expect(ilha.closest("[data-camada-flutuante]")).not.toBeNull();
    // O aviso do Sonner já nasce marcado pela própria biblioteca.
    expect(avisoDoSonner()?.closest("[data-sonner-toaster]")).not.toBeNull();
  });

  it("no navegador o aviso volta a receber o toque com a folha modal aberta", () => {
    // O Radix grava `pointer-events: none` no <body>; sem esta regra o aviso
    // herda o `none` e o dedo cai no véu — que fecha a folha.
    const css = readFileSync("src/index.css", "utf8");
    const regra = css.match(
      /\[data-camada-flutuante\],\s*\[data-sonner-toaster\]\s*\{([^}]*)\}/,
    );
    expect(regra?.[1]).toMatch(/pointer-events:\s*auto/);
  });
});
