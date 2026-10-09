// @vitest-environment jsdom
//
// ATALHOS DA ABA, ALTERNADOR DE TELAS E AÇÃO DO PAINEL (plano painel-simples,
// B8). Primitivos novos, ainda sem tela que os use: este teste é o contrato.
//
//   1. AtalhosDaAba lê nomes e rotas de NOMES_DO_PAINEL/PORTAS_DO_PAINEL —
//      em "clientes" mostra "Perguntas e avaliações" (UMA porta para as duas
//      telas) e "Avisar clientes", cada um com alvo de toque >= 44px
//      (`min-h-11`), e chama onNavigate com a rota certa.
//   2. O contador opcional entra no nome acessível (o selo visual é
//      aria-hidden, para não ser lido duas vezes).
//   3. AlternadorDeTelas marca a tela atual com aria-current="page".
//   4. AcaoDoPainel é um botão com alvo >= 44px, `type="button"` por padrão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcaoDoPainel } from "../../src/components/admin/primitivos/AcaoDoPainel";
import { AlternadorDeTelas } from "../../src/components/admin/primitivos/AlternadorDeTelas";
import { AtalhosDaAba } from "../../src/components/admin/primitivos/AtalhosDaAba";
import {
  NOMES_DO_PAINEL,
  NOME_DO_PAR_PERGUNTAS_E_AVALIACOES,
} from "../../src/config/nomes-do-painel";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

function renderizar(ui: React.ReactElement) {
  act(() => {
    raiz.render(ui);
  });
}

function botoes(): HTMLButtonElement[] {
  return Array.from(hospedeiro.querySelectorAll("button"));
}

function botaoPeloNome(nome: string): HTMLButtonElement {
  const achado = botoes().find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === nome,
  );
  if (!achado) {
    throw new Error(
      `sem botão "${nome}"; há: ${botoes()
        .map((b) => b.getAttribute("aria-label") ?? b.textContent)
        .join(" | ")}`,
    );
  }
  return achado;
}

describe("AtalhosDaAba", () => {
  it("em Clientes mostra 'Perguntas e avaliações' e 'Avisar clientes', com os nomes de NOMES_DO_PAINEL", () => {
    renderizar(<AtalhosDaAba aba="clientes" onNavigate={vi.fn()} />);
    expect(botoes().map((b) => b.textContent?.trim())).toEqual([
      NOME_DO_PAR_PERGUNTAS_E_AVALIACOES,
      NOMES_DO_PAINEL["admin-push"],
    ]);
    expect(botaoPeloNome("Perguntas e avaliações")).toBeTruthy();
    expect(botaoPeloNome("Avisar clientes")).toBeTruthy();
  });

  it("cada atalho tem alvo de toque de 44px", () => {
    renderizar(<AtalhosDaAba aba="clientes" onNavigate={vi.fn()} />);
    for (const b of botoes()) {
      expect(b.className).toContain("min-h-11");
    }
  });

  it("chama onNavigate com a rota certa", () => {
    const onNavigate = vi.fn();
    renderizar(<AtalhosDaAba aba="clientes" onNavigate={onNavigate} />);
    act(() => {
      botaoPeloNome("Perguntas e avaliações").click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-qa");
    act(() => {
      botaoPeloNome("Avisar clientes").click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-push");
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("lê as portas das outras abas (Ajustes tem 4; Pedidos, Devoluções)", () => {
    renderizar(<AtalhosDaAba aba="ajustes" onNavigate={vi.fn()} />);
    expect(botoes().map((b) => b.textContent?.trim())).toEqual([
      "Minha loja",
      "Banners",
      "Vitrines",
      "Entrega e frete",
    ]);
    renderizar(<AtalhosDaAba aba="pedidos" onNavigate={vi.fn()} />);
    expect(botoes().map((b) => b.textContent?.trim())).toEqual(["Devoluções"]);
  });

  it("o contador opcional entra no nome acessível, e o número visual é aria-hidden", () => {
    renderizar(
      <AtalhosDaAba
        aba="clientes"
        onNavigate={vi.fn()}
        contadores={{
          "admin-qa": { valor: 3, legenda: "sem resposta" },
          "admin-push": { valor: 0 },
        }}
      />,
    );
    const perguntas = botaoPeloNome("Perguntas e avaliações, 3 sem resposta");
    const selo = perguntas.querySelector("[aria-hidden='true']");
    expect(selo?.textContent).toBe("3");
    // contador zero não aparece: o nome continua só o da tela
    expect(botaoPeloNome("Avisar clientes")).toBeTruthy();
  });

  it("na porta fundida, o contador soma Perguntas e Avaliações (ausente conta 0)", () => {
    renderizar(
      <AtalhosDaAba
        aba="clientes"
        onNavigate={vi.fn()}
        contadores={{
          "admin-qa": { valor: 2, legenda: "novas" },
          "admin-reviews": { valor: 3 },
        }}
      />,
    );
    const porta = botaoPeloNome("Perguntas e avaliações, 5 novas");
    expect(porta.querySelector("[aria-hidden='true']")?.textContent).toBe("5");

    // só Avaliações com contador: a porta fundida não pode perdê-lo
    renderizar(
      <AtalhosDaAba
        aba="clientes"
        onNavigate={vi.fn()}
        contadores={{ "admin-reviews": { valor: 4 } }}
      />,
    );
    expect(botaoPeloNome("Perguntas e avaliações, 4")).toBeTruthy();
  });

  it("contador sem legenda entra só com o número", () => {
    renderizar(
      <AtalhosDaAba
        aba="clientes"
        onNavigate={vi.fn()}
        contadores={{ "admin-push": { valor: 2 } }}
      />,
    );
    expect(botaoPeloNome("Avisar clientes, 2")).toBeTruthy();
  });
});

describe("AlternadorDeTelas", () => {
  it("marca a tela atual com aria-current='page' e só ela", () => {
    renderizar(
      <AlternadorDeTelas atual="admin-reviews" onNavigate={vi.fn()} />,
    );
    expect(botoes().map((b) => b.textContent?.trim())).toEqual([
      "Perguntas",
      "Avaliações",
    ]);
    expect(botaoPeloNome("Avaliações").getAttribute("aria-current")).toBe(
      "page",
    );
    expect(botaoPeloNome("Perguntas").hasAttribute("aria-current")).toBe(false);
  });

  it("alvos de 44px e navegação para a outra tela", () => {
    const onNavigate = vi.fn();
    renderizar(<AlternadorDeTelas atual="admin-qa" onNavigate={onNavigate} />);
    for (const b of botoes()) {
      expect(b.className).toContain("min-h-11");
    }
    act(() => {
      botaoPeloNome("Avaliações").click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-reviews");
  });

  it("clicar na tela em que já está não navega", () => {
    const onNavigate = vi.fn();
    renderizar(<AlternadorDeTelas atual="admin-qa" onNavigate={onNavigate} />);
    act(() => {
      botaoPeloNome("Perguntas").click();
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("AcaoDoPainel", () => {
  it("é um botão type=button com alvo de 44px", () => {
    const onClick = vi.fn();
    renderizar(<AcaoDoPainel onClick={onClick}>Salvar</AcaoDoPainel>);
    const b = botaoPeloNome("Salvar");
    expect(b.type).toBe("button");
    expect(b.className).toContain("min-h-11");
    expect(b.className).toContain("min-w-11");
    act(() => {
      b.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("desabilitado não dispara onClick", () => {
    const onClick = vi.fn();
    renderizar(
      <AcaoDoPainel onClick={onClick} disabled>
        Salvar
      </AcaoDoPainel>,
    );
    act(() => {
      botaoPeloNome("Salvar").click();
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("'carregando' desabilita, marca aria-busy e não dispara onClick", () => {
    const onClick = vi.fn();
    renderizar(
      <AcaoDoPainel onClick={onClick} carregando>
        Salvar
      </AcaoDoPainel>,
    );
    const b = botaoPeloNome("Salvar");
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("aria-busy")).toBe("true");
    act(() => {
      b.click();
    });
    expect(onClick).not.toHaveBeenCalled();
  });
});
