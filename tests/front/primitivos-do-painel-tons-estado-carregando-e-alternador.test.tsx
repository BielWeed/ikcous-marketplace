// @vitest-environment jsdom
//
// Primitivos do painel (AcaoDoPainel, SeloDeStatus, EstadoVazio,
// AlternadorDeTelas) — o que `primitivos-do-painel.test.tsx` e os testes de
// atalhos não olhavam. Caça por mutação (25/11/2026) — sobreviveram: o
// `aria-busy` do botão (aparecia "false" em botão parado), o spinner
// de "carregando", a cor de cada variante e de cada tom do selo, o tom padrão
// do selo, o `type` do botão do estado vazio, o ícone decorativo do estado
// vazio e quem é a tela marcada no alternador.
//
// Mutante equivalente anotado: acrescentar uma instrução vazia (`void 0;`) no
// início do `onClick` do alternador não muda nada observável.
import { AcaoDoPainel } from "@/components/admin/primitivos/AcaoDoPainel";
import { AlternadorDeTelas } from "@/components/admin/primitivos/AlternadorDeTelas";
import { EstadoVazio } from "@/components/admin/primitivos/EstadoVazio";
import {
  SeloDeStatus,
  type TomDoSelo,
} from "@/components/admin/primitivos/SeloDeStatus";
import { Package } from "lucide-react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(no: React.ReactNode) {
  act(() => {
    raiz.render(no);
  });
}

describe("AcaoDoPainel", () => {
  const botao = () => host.querySelector("button") as HTMLButtonElement;

  it("parado: botão habilitado, sem aria-busy, tipo 'button' e variante primária por padrão", () => {
    montar(<AcaoDoPainel>Salvar</AcaoDoPainel>);
    expect(botao().type).toBe("button");
    expect(botao().disabled).toBe(false);
    expect(botao().hasAttribute("aria-busy")).toBe(false);
    expect(botao().className).toContain("bg-foreground");
    expect(botao().className).toContain("min-h-11");
    expect(botao().className).toContain("min-w-11");
    expect(botao().querySelector("svg")).toBeNull();
  });

  it("carregando: trava, anuncia aria-busy=true, troca o ícone por spinner e mantém o texto", () => {
    montar(
      <AcaoDoPainel carregando icone={Package}>
        Salvar
      </AcaoDoPainel>,
    );
    expect(botao().disabled).toBe(true);
    expect(botao().getAttribute("aria-busy")).toBe("true");
    expect(botao().textContent).toBe("Salvar");
    const icones = botao().querySelectorAll("svg");
    expect(icones).toHaveLength(1);
    expect(icones[0].getAttribute("class")).toContain("animate-spin");
    expect(icones[0].getAttribute("aria-hidden")).toBe("true");
  });

  it("parado com ícone: mostra o ícone da tela (sem girar)", () => {
    montar(<AcaoDoPainel icone={Package}>Salvar</AcaoDoPainel>);
    const icones = botao().querySelectorAll("svg");
    expect(icones).toHaveLength(1);
    expect(icones[0].getAttribute("class")).not.toContain("animate-spin");
    expect(icones[0].getAttribute("aria-hidden")).toBe("true");
  });

  it("disabled da tela vale sozinho, sem aria-busy; carregando=false não trava", () => {
    montar(<AcaoDoPainel disabled>Salvar</AcaoDoPainel>);
    expect(botao().disabled).toBe(true);
    expect(botao().hasAttribute("aria-busy")).toBe(false);
    montar(<AcaoDoPainel disabled={false}>Salvar</AcaoDoPainel>);
    expect(botao().disabled).toBe(false);
  });

  it("cada variante tem a sua cor, e só a dela", () => {
    montar(<AcaoDoPainel variante="primaria">x</AcaoDoPainel>);
    expect(botao().className).toContain("bg-foreground text-background");
    montar(<AcaoDoPainel variante="secundaria">x</AcaoDoPainel>);
    expect(botao().className).toContain("border-admin-border-strong");
    expect(botao().className).toContain("text-zinc-100");
    expect(botao().className).not.toContain("bg-foreground");
    montar(<AcaoDoPainel variante="perigo">x</AcaoDoPainel>);
    expect(botao().className).toContain("text-red-300");
    expect(botao().className).toContain("border-red-500/40");
    expect(botao().className).not.toContain("bg-foreground");
  });

  it("repassa o que a tela manda (onClick, type=submit, className, aria-label)", () => {
    const aoClicar = vi.fn();
    montar(
      <AcaoDoPainel
        type="submit"
        className="w-full"
        aria-label="Salvar tudo"
        onClick={aoClicar}
      >
        Salvar
      </AcaoDoPainel>,
    );
    expect(botao().type).toBe("submit");
    expect(botao().className).toContain("w-full");
    expect(botao().getAttribute("aria-label")).toBe("Salvar tudo");
    act(() => botao().click());
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });
});

describe("SeloDeStatus", () => {
  const selo = () => host.firstElementChild as HTMLElement;

  it.each([
    ["ok", "text-emerald-300", "border-emerald-500/30"],
    ["atencao", "text-amber-300", "border-amber-500/30"],
    ["erro", "text-red-300", "border-red-500/30"],
    ["neutro", "text-zinc-300", "border-admin-border"],
  ] as [TomDoSelo, string, string][])(
    "tom %s usa a cor %s e a moldura %s",
    (tom, texto, moldura) => {
      montar(<SeloDeStatus tom={tom}>x</SeloDeStatus>);
      expect(selo().className).toContain(texto);
      expect(selo().className).toContain(moldura);
    },
  );

  it("sem tom, o selo é NEUTRO (cinza), não verde", () => {
    montar(<SeloDeStatus>Aguardando</SeloDeStatus>);
    expect(selo().className).toContain("text-zinc-300");
    expect(selo().className).not.toContain("emerald");
  });

  it("o texto fica dentro de um span próprio, ao lado do ícone, e o className da tela entra", () => {
    montar(
      <SeloDeStatus tom="ok" className="ml-2">
        Pago
      </SeloDeStatus>,
    );
    expect(selo().querySelector("span")?.textContent).toBe("Pago");
    expect(selo().className).toContain("ml-2");
    expect(selo().className).toContain("rounded-full");
    expect(selo().querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("EstadoVazio", () => {
  it("título e frase cada um no seu parágrafo, na ordem", () => {
    montar(
      <EstadoVazio
        titulo="Sem pedidos"
        frase="Quando alguém comprar, aparece aqui."
      />,
    );
    const ps = [...host.querySelectorAll("p")].map((p) => p.textContent);
    expect(ps).toEqual(["Sem pedidos", "Quando alguém comprar, aparece aqui."]);
  });

  it("o ícone é decoração (aria-hidden=true) e some quando não vem", () => {
    montar(<EstadoVazio icone={Package} titulo="t" frase="f" />);
    expect(host.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    montar(<EstadoVazio titulo="t" frase="f" />);
    expect(host.querySelector("svg")).toBeNull();
  });

  it("o botão de ação é type=button (dentro de um formulário não envia) e leva o rótulo", () => {
    const aoEnviar = vi.fn((e: React.FormEvent) => e.preventDefault());
    const aoClicar = vi.fn();
    montar(
      <form onSubmit={aoEnviar}>
        <EstadoVazio
          titulo="t"
          frase="f"
          acao={{ rotulo: "Cadastrar", aoClicar }}
        />
      </form>,
    );
    const botao = host.querySelector("button") as HTMLButtonElement;
    expect(botao.type).toBe("button");
    expect(botao.textContent).toBe("Cadastrar");
    act(() => botao.click());
    expect(aoClicar).toHaveBeenCalledTimes(1);
    expect(aoEnviar).not.toHaveBeenCalled();
  });
});

describe("AlternadorDeTelas", () => {
  const botoes = () => [...host.querySelectorAll("button")];

  it("dois botões com os nomes do painel; só a tela atual leva aria-current=page", () => {
    montar(<AlternadorDeTelas atual="admin-reviews" onNavigate={vi.fn()} />);
    expect(botoes().map((b) => b.textContent)).toEqual([
      "Perguntas",
      "Avaliações",
    ]);
    expect(botoes().map((b) => b.getAttribute("aria-current"))).toEqual([
      null,
      "page",
    ]);
    expect(botoes().every((b) => b.type === "button")).toBe(true);
    expect(host.querySelector("nav")?.getAttribute("aria-label")).toBe(
      "Telas desta seção",
    );
  });

  it("a marcação acompanha a tela atual (primeira marcada quando atual = admin-qa)", () => {
    montar(<AlternadorDeTelas atual="admin-qa" onNavigate={vi.fn()} />);
    expect(botoes().map((b) => b.getAttribute("aria-current"))).toEqual([
      "page",
      null,
    ]);
  });

  it("clicar na outra tela navega para ela; clicar na atual não navega", () => {
    const aoNavegar = vi.fn();
    montar(<AlternadorDeTelas atual="admin-qa" onNavigate={aoNavegar} />);
    act(() => botoes()[0].click());
    expect(aoNavegar).not.toHaveBeenCalled();
    act(() => botoes()[1].click());
    expect(aoNavegar).toHaveBeenCalledExactlyOnceWith("admin-reviews");
  });

  it("cada botão é um alvo de 44px e o ativo tem o peso de letra mais forte", () => {
    montar(<AlternadorDeTelas atual="admin-qa" onNavigate={vi.fn()} />);
    expect(botoes().every((b) => b.className.includes("min-h-11"))).toBe(true);
    expect(botoes()[0].className).toContain("font-bold");
    expect(botoes()[1].className).not.toContain("font-bold");
  });
});
