// @vitest-environment jsdom
//
// Relato do dono (27/11/2026, celular): no Financeiro → "Novo lançamento",
// tocar numa opção da Categoria (ou de qualquer campo de escolha) FECHAVA
// TUDO — a lista e a folha do lançamento — e o que ele tinha digitado ia
// embora. No computador, clicar na opção não fazia nada.
//
// Causa: o guardião do clique pós-fecho da `ui/sheet` (a casca da
// FolhaFinanceira) só considerava "dentro" o que está no DOM de uma
// `[data-slot="sheet-content"]`. A lista de escolha (folha no celular,
// popover no computador) mora num PORTAL no body, fora desse DOM — então o
// toque na opção era lido como "toque fora da folha": o guardião engolia o
// click (a opção nunca era escolhida) e, no toque, fechava a folha-mãe.
//
// O que se prova aqui é o gesto INTEIRO, como o dedo e o mouse fazem
// (pointerdown → pointerup → click, com o `pointerType` de cada um): o
// `.click()` sozinho dos testes antigos nunca armava o guardião.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { act, useCallback, useEffect, useRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "8a1f0c2e-2222-4222-8222-000000000002" } }),
}));

import { FolhaFinanceira } from "@/components/admin/financeiro/FolhaFinanceira";
import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { consumirVoltarDaFolhaAntesDaGuarda } from "@/hooks/useVoltarFechaAFolha";
import { CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA } from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

type Ponteiro = "touch" | "mouse";

class ResizeObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function telaDe(computador: boolean) {
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: computador && consulta.includes("min-width: 1024px"),
    media: consulta,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
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

// O Radix e o guardião só passam a ouvir o gesto no tique seguinte à abertura.
async function esperar(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

const lista = () =>
  document.querySelector<HTMLElement>(
    '[data-lista-de-escolha="folha"], [data-lista-de-escolha="popover"]',
  );
/** O texto da opção: o dedo cai no texto, não na caixa da opção. */
const textoDaOpcao = (valor: string) =>
  document.querySelector<HTMLElement>(
    `[role="option"][data-valor="${valor}"] span`,
  ) ??
  document.querySelector<HTMLElement>(`[role="option"][data-valor="${valor}"]`);
const folhaMae = () => document.querySelector("[data-folha-financeira]");

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverFalso);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const CONTAS: OpcaoDaLista[] = [
  { valor: "caixa", rotulo: "Caixa da loja" },
  { valor: "banco", rotulo: "Conta no banco" },
  { valor: "mp", rotulo: "Mercado Pago" },
];

function Conta({ aoMudar }: { readonly aoMudar: (v: string) => void }) {
  const [valor, setValor] = useState("caixa");
  return (
    <CampoDeEscolha
      id="fin-conta"
      rotulo="Conta"
      opcoes={CONTAS}
      valor={valor}
      aoMudar={(v) => {
        setValor(v);
        aoMudar(v);
      }}
    />
  );
}

const CASOS = (["touch", "mouse"] as const).flatMap((ponteiro) =>
  ([false, true] as const).map((computador) => ({
    ponteiro,
    computador,
    nome: `${ponteiro === "touch" ? "toque" : "mouse"} no ${computador ? "computador" : "celular"}`,
  })),
);

describe.each(CASOS)(
  "lista de escolha dentro da FolhaFinanceira — $nome",
  ({ ponteiro, computador }) => {
    beforeEach(() => telaDe(computador));

    async function montarEAbrir() {
      const aoFechar = vi.fn();
      const aoMudar = vi.fn();
      act(() => {
        raiz.render(
          <FolhaFinanceira titulo="Novo lançamento" aoFechar={aoFechar}>
            <Conta aoMudar={aoMudar} />
          </FolhaFinanceira>,
        );
      });
      await esperar();
      const botao = document.getElementById("fin-conta") as HTMLElement;
      await tocar(botao, ponteiro);
      expect(lista()).not.toBeNull();
      await esperar();
      return { aoFechar, aoMudar };
    }

    it("tocar numa opção escolhe e fecha só a lista; a folha-mãe fica", async () => {
      const { aoFechar, aoMudar } = await montarEAbrir();
      await tocar(textoDaOpcao("mp") as HTMLElement, ponteiro);
      await esperar();

      // O toque fechava a folha-mãe; o mouse só engolia a escolha.
      expect(aoFechar).not.toHaveBeenCalled();
      expect(aoMudar).toHaveBeenCalledWith("mp");
      expect(lista()).toBeNull();
      expect(folhaMae()).not.toBeNull();
      expect(document.getElementById("fin-conta")?.dataset.valor).toBe("mp");
    });

    it("tocar no véu da lista fecha só a lista, sem fechar a folha-mãe", async () => {
      if (computador) return; // o popover não tem véu
      const { aoFechar, aoMudar } = await montarEAbrir();
      const veu = document.querySelector<HTMLElement>(
        '[data-lista-de-escolha="veu"]',
      ) as HTMLElement;
      await tocar(veu, ponteiro);
      await esperar();

      expect(lista()).toBeNull();
      expect(aoMudar).not.toHaveBeenCalled();
      expect(aoFechar).not.toHaveBeenCalled();
      expect(folhaMae()).not.toBeNull();
    });
  },
);

// Toque de tela larga (tablet deitado, iPad Pro, notebook de toque): a lista
// abre como popover MODAL por cima da folha. O Radix desliga os toques na
// folha de baixo (pointer-events:none no content), mas o véu dela segue
// tocável — tocar fora da lista (até num outro campo) cai no véu da folha. O
// guardião lia isso como "toque fora da folha", engolia o click e fechava a
// folha inteira; a lista, que fecha nesse mesmo click, ficava aberta.
describe.each(["touch", "mouse"] as const)(
  "tocar fora do popover da lista, no computador — %s",
  (ponteiro) => {
    beforeEach(() => telaDe(true));

    it("fecha só a lista; a folha-mãe fica, sem pedir para descartar", async () => {
      const aoFechar = vi.fn();
      const aoMudar = vi.fn();
      act(() => {
        raiz.render(
          <FolhaFinanceira titulo="Novo lançamento" aoFechar={aoFechar}>
            <Conta aoMudar={aoMudar} />
          </FolhaFinanceira>,
        );
      });
      await esperar();
      await tocar(
        document.getElementById("fin-conta") as HTMLElement,
        ponteiro,
      );
      await esperar();
      expect(
        document.querySelector('[data-lista-de-escolha="popover"]'),
      ).not.toBeNull();
      // A premissa, medida (não forjada): com o popover modal por cima, o
      // Radix desliga os toques no content da folha de baixo.
      expect(
        document.querySelector<HTMLElement>('[data-slot="sheet-content"]')
          ?.style.pointerEvents,
      ).toBe("none");

      const veuDaFolha = document.querySelector(
        '[data-slot="sheet-overlay"]',
      ) as HTMLElement;
      await tocar(veuDaFolha, ponteiro);
      await esperar();

      expect(lista()).toBeNull();
      expect(aoFechar).not.toHaveBeenCalled();
      expect(aoMudar).not.toHaveBeenCalled();
      expect(folhaMae()).not.toBeNull();
      expect(document.body.textContent).not.toContain("Descartar");
    });
  },
);

// Depois de escolher na lista, tocar no véu da folha tem de SÓ fechar. A
// escolha foi um gesto vindo de portal filho (a lista), que a folha marca como
// "clique de dentro"; se essa marca sobrevivesse ao gesto seguinte, o toque no
// véu passaria pelo guardião como se fosse de dentro: a folha fecha, mas o
// mesmo clique atravessa até o que está por trás (o card que abre o produto).
// O fundo espiado é ANCESTRAL da folha (anatomia do ProductCard): no toque o
// click cai no véu vivo e borbulha pela árvore React até ele; no mouse o véu
// some no pointerdown e o click cai no fundo, que ficou por baixo.
function CenaComFundo({
  aoFechar,
  aoFundo,
}: {
  readonly aoFechar: () => void;
  readonly aoFundo: () => void;
}) {
  const [aberta, setAberta] = useState(true);
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- mesmo padrão do wrapper do ProductCard: div clicável intencional (é o "fundo" que não pode receber o click)
    <div data-testid="fundo" onClick={aoFundo}>
      {aberta ? (
        <FolhaFinanceira
          titulo="Novo lançamento"
          aoFechar={() => {
            aoFechar();
            setAberta(false);
          }}
        >
          <Conta aoMudar={vi.fn()} />
        </FolhaFinanceira>
      ) : null}
    </div>
  );
}

describe.each(["touch", "mouse"] as const)(
  "depois de escolher na lista, tocar no véu da folha só fecha — %s",
  (ponteiro) => {
    beforeEach(() => telaDe(false));

    it("a folha fecha e o clique não atravessa até o fundo", async () => {
      const aoFechar = vi.fn();
      const aoFundo = vi.fn();
      act(() => {
        raiz.render(<CenaComFundo aoFechar={aoFechar} aoFundo={aoFundo} />);
      });
      await esperar();
      await tocar(
        document.getElementById("fin-conta") as HTMLElement,
        ponteiro,
      );
      await esperar();
      await tocar(textoDaOpcao("mp") as HTMLElement, ponteiro);
      await esperar();
      expect(lista()).toBeNull();
      expect(folhaMae()).not.toBeNull();
      expect(document.getElementById("fin-conta")?.dataset.valor).toBe("mp");
      // Os cliques legítimos de dentro da folha também borbulham até o
      // ancestral: o que se mede é só o gesto no véu.
      aoFundo.mockClear();

      // O gesto como o aparelho manda: cada evento cai no que está no ponto
      // tocado NAQUELE instante — o véu enquanto vive, o fundo depois.
      const veu = document.querySelector(
        '[data-slot="sheet-overlay"]',
      ) as HTMLElement;
      const fundo = hospedeiro.querySelector(
        '[data-testid="fundo"]',
      ) as HTMLElement;
      const noPonto = () => (veu.isConnected ? veu : fundo);
      await act(async () => {
        veu.dispatchEvent(eventoDePonteiro("pointerdown", ponteiro));
        noPonto().dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
        noPonto().dispatchEvent(eventoDePonteiro("pointerup", ponteiro));
        noPonto().dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
        );
        noPonto().dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
      });
      await esperar();

      expect(aoFechar).toHaveBeenCalledTimes(1);
      expect(folhaMae()).toBeNull();
      expect(aoFundo).not.toHaveBeenCalled();
    });
  },
);

// A tela inteira, com o Voltar ligado como o App liga (`onSetBackOverride` e o
// ouvinte de `popstate` que entrega primeiro às folhas): é o caminho do dono.
function AppFalso() {
  const [desvio, setDesvio] = useState<(() => void) | null>(null);
  const desvioRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    desvioRef.current = desvio;
  }, [desvio]);
  useEffect(() => {
    const aoVoltar = (e: PopStateEvent) => {
      if (consumirVoltarDaFolhaAntesDaGuarda(e)) return;
      desvioRef.current?.();
    };
    globalThis.addEventListener("popstate", aoVoltar);
    return () => globalThis.removeEventListener("popstate", aoVoltar);
  }, []);
  const aoDesviar = useCallback(
    (fn: (() => void) | null) => setDesvio(() => fn),
    [],
  );
  return (
    <AdminFinanceiroView
      onNavigate={vi.fn()}
      active
      onSetBackOverride={aoDesviar}
      onSetDirty={vi.fn()}
    />
  );
}

async function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("Novo lançamento no celular, com o toque do dedo", () => {
  beforeEach(() => {
    telaDe(false);
    globalThis.history.replaceState(null, "", "/admin/financeiro");
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === "fin_resumo")
        return { data: { saldo_total: 0 }, error: null };
      if (nome === "fin_contas_listar")
        return {
          data: [
            {
              id: CONTA_CAIXA_DA_LOJA,
              nome: "Caixa da loja",
              tipo: "caixa",
              saldo_inicial: 0,
              saldo_inicial_em: "2026-01-01",
              ativa: true,
              sistema: true,
              saldo: 0,
            },
            {
              id: CONTA_BANCARIA,
              nome: "Conta bancária",
              tipo: "banco",
              saldo_inicial: 0,
              saldo_inicial_em: "2026-01-01",
              ativa: true,
              sistema: true,
              saldo: 0,
            },
          ],
          error: null,
        };
      if (nome === "fin_categorias_listar")
        return {
          data: [
            {
              id: "cat-embalagens",
              nome: "Embalagens",
              natureza: "despesa",
              grupo_dre: "despesa_variavel",
              ativa: true,
            },
          ],
          error: null,
        };
      return { data: [], error: null };
    });
  });

  it("escolher Categoria e Conta mantém a folha aberta, com o que foi digitado", async () => {
    await act(async () => raiz.render(<AppFalso />));
    await esperar(20);
    const novo = [...hospedeiro.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Novo lançamento",
    ) as HTMLElement;
    await tocar(novo, "touch");
    await esperar(20);
    expect(folhaMae()).not.toBeNull();

    await digitar("fin-lanc-valor", "45,90");
    await digitar("fin-lanc-descricao", "Caixas de papelão");

    for (const [campo, valor] of [
      ["fin-lanc-categoria", "cat-embalagens"],
      ["fin-lanc-conta", CONTA_CAIXA_DA_LOJA],
    ] as const) {
      await tocar(document.getElementById(campo) as HTMLElement, "touch");
      await esperar();
      expect(lista()).not.toBeNull();
      await tocar(textoDaOpcao(valor) as HTMLElement, "touch");
      // A lista devolve a entrada do histórico: deixa o popstate chegar.
      await esperar(50);

      expect(lista()).toBeNull();
      expect(folhaMae()).not.toBeNull();
      expect(document.getElementById(campo)?.dataset.valor).toBe(valor);
    }

    // Nada de "Descartar o que você escreveu?": ninguém pediu para fechar.
    expect(document.body.textContent).not.toContain("Descartar");
    expect(
      (document.getElementById("fin-lanc-descricao") as HTMLInputElement).value,
    ).toBe("Caixas de papelão");
    expect(
      (document.getElementById("fin-lanc-valor") as HTMLInputElement).value,
    ).toBe("45,90");
  });
});
