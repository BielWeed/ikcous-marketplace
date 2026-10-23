// @vitest-environment jsdom
//
// "Privacidade e meus dados" no estilo Tinta (23/10/2026): o textão virou cabeçalho + cartão de prazo +
// três linhas-sanfona + dois botões de contorno. Aqui se prova a APRESENTAÇÃO nova: o texto da loja continua
// inteiro e literal (a lista "o que a exclusão apaga" nunca é abreviada), a sanfona abre e fecha com os
// atributos de acessibilidade certos, e o que já existia (pedido aberto, falha ao carregar, botões presos
// enquanto envia) continua funcionando. A lógica dos pedidos é provada em privacidade-e-meus-dados.test.tsx.
import { PrivacidadeEMeusDados } from "@/components/account/PrivacidadeEMeusDados";
import { TEXTOS_DA_CLIENTE } from "@/config/textos-de-privacidade";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

interface Resposta {
  data: unknown;
  error: unknown;
}

const banco = {
  lista: { data: [], error: null } as Resposta,
  // Quando preenchida, a gravação só termina quando o teste liberar (botões presos enquanto envia).
  insercaoPendente: null as Promise<Resposta> | null,
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: async () => banco.lista }),
      }),
      insert: () => ({
        select: () => ({
          single: async () =>
            banco.insercaoPendente ?? { data: null, error: null },
        }),
      }),
    }),
  },
}));

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const botaoPorTexto = (texto: string, dentro: ParentNode = document.body) =>
  [...dentro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    (b.textContent ?? "").includes(texto),
  );

const linha = (titulo: string) => {
  const b = botaoPorTexto(titulo);
  if (!b) throw new Error(`linha "${titulo}" não encontrada`);
  return b;
};

const painelDe = (b: HTMLButtonElement) =>
  document.getElementById(b.getAttribute("aria-controls") ?? "") as HTMLElement;

describe("PrivacidadeEMeusDados no estilo Tinta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    banco.lista = { data: [], error: null };
    banco.insercaoPendente = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  async function montar() {
    act(() => {
      raiz.render(
        <PrivacidadeEMeusDados userId="cliente-1" emailAtual="a@b.com" />,
      );
    });
    await assentar();
  }

  it("traz o próprio cabeçalho: rótulo, título h2 ligado à seção e a abertura", async () => {
    await montar();
    const secao = hospedeiro.querySelector("section");
    expect(secao?.getAttribute("aria-labelledby")).toBe("privacidade-titulo");
    const titulo = document.getElementById("privacidade-titulo");
    expect(titulo?.tagName).toBe("H2");
    expect(titulo?.textContent).toBe(TEXTOS_DA_CLIENTE.titulo);
    expect(titulo?.className).toContain("text-[28px]");
    expect(secao?.textContent).toContain(TEXTOS_DA_CLIENTE.rotuloDaTela);
    expect(secao?.textContent).toContain(TEXTOS_DA_CLIENTE.abertura);
  });

  it("o prazo vem num cartão próprio, com o texto literal da loja", async () => {
    await montar();
    const cartao = [...hospedeiro.querySelectorAll("div")].find(
      (d) =>
        (d.textContent ?? "") ===
        `${TEXTOS_DA_CLIENTE.rotuloDoPrazo}${TEXTOS_DA_CLIENTE.prazo}`,
    );
    expect(cartao).toBeDefined();
    expect(cartao?.className).toContain("rounded-2xl");
    expect(cartao?.className).toContain("bg-muted/30");
  });

  it("são três linhas-sanfona, cada uma um botão com aria-expanded e aria-controls que apontam para um painel que existe", async () => {
    await montar();
    for (const titulo of [
      TEXTOS_DA_CLIENTE.guardaTitulo,
      TEXTOS_DA_CLIENTE.apagaTitulo,
      TEXTOS_DA_CLIENTE.ficaTitulo,
    ]) {
      const b = linha(titulo);
      expect(b.getAttribute("aria-expanded")).toMatch(/^(true|false)$/);
      expect(painelDe(b)).not.toBeNull();
    }
  });

  it("'o que a exclusão apaga' abre por padrão; as outras duas começam fechadas", async () => {
    await montar();
    expect(
      linha(TEXTOS_DA_CLIENTE.apagaTitulo).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      linha(TEXTOS_DA_CLIENTE.guardaTitulo).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      linha(TEXTOS_DA_CLIENTE.ficaTitulo).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(painelDe(linha(TEXTOS_DA_CLIENTE.apagaTitulo)).hidden).toBe(false);
    expect(painelDe(linha(TEXTOS_DA_CLIENTE.guardaTitulo)).hidden).toBe(true);
    expect(painelDe(linha(TEXTOS_DA_CLIENTE.ficaTitulo)).hidden).toBe(true);
  });

  it("o resumo da lista diz 'N itens' calculado do texto da loja, não um número fixo", async () => {
    await montar();
    const n = TEXTOS_DA_CLIENTE.apaga.length;
    expect(n).toBeGreaterThan(1);
    expect(linha(TEXTOS_DA_CLIENTE.apagaTitulo).textContent).toContain(
      `${n} itens`,
    );
  });

  it("aberta, a lista mostra TODOS os itens, literais, na ordem, um por linha, sem abreviar", async () => {
    await montar();
    const painel = painelDe(linha(TEXTOS_DA_CLIENTE.apagaTitulo));
    const itens = [...painel.querySelectorAll("li")].map((li) =>
      // tira o travessão decorativo do começo
      (li.textContent ?? "")
        .replace(/^—/, "")
        .trim(),
    );
    expect(itens).toEqual([...TEXTOS_DA_CLIENTE.apaga]);
    // Os desenhos mostram versões encurtadas: elas não podem aparecer.
    expect(painel.textContent).not.toContain("Nome, telefone e CPF");
    expect(painel.textContent).not.toContain("Fotos de devolução enviadas");
  });

  it("linha fechada mostra o resumo recortado em 2 linhas (texto inteiro no DOM); aberta mostra o texto integral no painel e some o resumo", async () => {
    await montar();
    const b = linha(TEXTOS_DA_CLIENTE.guardaTitulo);
    // Fechada: o resumo é o próprio texto, recortado só por CSS.
    const resumo = b.querySelector<HTMLElement>(".line-clamp-2");
    expect(resumo?.textContent).toBe(TEXTOS_DA_CLIENTE.guarda);

    act(() => b.click());
    expect(b.getAttribute("aria-expanded")).toBe("true");
    const painel = painelDe(b);
    expect(painel.hidden).toBe(false);
    expect(painel.textContent).toBe(TEXTOS_DA_CLIENTE.guarda);
    // O texto não aparece duas vezes na tela: o resumo saiu.
    expect(b.querySelector(".line-clamp-2")).toBeNull();
  });

  it("abre e fecha de novo (a mesma linha) e cada linha é independente das outras", async () => {
    await montar();
    const fica = linha(TEXTOS_DA_CLIENTE.ficaTitulo);
    act(() => fica.click());
    expect(fica.getAttribute("aria-expanded")).toBe("true");
    expect(painelDe(fica).textContent).toBe(TEXTOS_DA_CLIENTE.fica);
    // A lista de "apaga" não fechou por causa disso.
    expect(
      linha(TEXTOS_DA_CLIENTE.apagaTitulo).getAttribute("aria-expanded"),
    ).toBe("true");

    act(() => fica.click());
    expect(fica.getAttribute("aria-expanded")).toBe("false");
    expect(painelDe(fica).hidden).toBe(true);

    const apaga = linha(TEXTOS_DA_CLIENTE.apagaTitulo);
    act(() => apaga.click());
    expect(apaga.getAttribute("aria-expanded")).toBe("false");
    expect(painelDe(apaga).hidden).toBe(true);
    // Fechada, ainda diz quantos itens são.
    expect(apaga.textContent).toContain(
      `${TEXTOS_DA_CLIENTE.apaga.length} itens`,
    );
  });

  it("os dois botões de ação: tinta e vermelho de contorno, nunca a cor da marca (bg-primary), 52 px e alvo de 44 px", async () => {
    await montar();
    const corrigir = botaoPorTexto(TEXTOS_DA_CLIENTE.botaoCorrigirEmail);
    const excluir = botaoPorTexto(TEXTOS_DA_CLIENTE.botaoExcluir);
    for (const b of [corrigir, excluir]) {
      expect(b?.className).toContain("h-[52px]");
      expect(b?.className).toContain("min-h-11");
      expect(b?.className).toContain("rounded-2xl");
      expect(b?.className).not.toContain("bg-primary");
    }
    expect(corrigir?.className).toContain("border-foreground");
    expect(excluir?.className).toContain("border-red-300");
    expect(excluir?.className).toContain("text-red-600");
  });

  it("pedido aberto: aviso em cartão de linha fina com ponto colorido, SEM bloco pintado", async () => {
    banco.lista = {
      data: [
        {
          id: "p1",
          user_id: "cliente-1",
          tipo: "excluir_conta",
          email_novo: null,
          situacao: "aberto",
          criado_em: "2026-10-14T12:00:00Z",
          atendido_em: null,
          observacao: null,
        },
      ],
      error: null,
    };
    await montar();
    const aviso = hospedeiro.querySelector<HTMLElement>('[role="status"]');
    expect(aviso?.textContent).toContain("Pedido enviado em 14/10/2026");
    expect(aviso?.className).toContain("border-border");
    expect(aviso?.className).not.toMatch(/bg-(emerald|zinc|red|amber)-/);
    expect(aviso?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("falha ao carregar: o aviso continua, sem bloco vermelho pintado, e 'Ver de novo meus pedidos' funciona", async () => {
    banco.lista = { data: null, error: { code: "08006", message: "x" } };
    await montar();
    const alerta = hospedeiro.querySelector<HTMLElement>('[role="alert"]');
    expect(alerta?.textContent).toContain(TEXTOS_DA_CLIENTE.falhaAoCarregar);
    expect(alerta?.className).not.toMatch(/bg-red-/);
    expect(botaoPorTexto(TEXTOS_DA_CLIENTE.botaoExcluir)).toBeUndefined();
    banco.lista = { data: [], error: null };
    await act(async () => {
      botaoPorTexto(TEXTOS_DA_CLIENTE.recarregar)?.click();
    });
    await assentar();
    expect(botaoPorTexto(TEXTOS_DA_CLIENTE.botaoExcluir)).toBeDefined();
  });

  it("enquanto o pedido é enviado, os dois botões da tela ficam desabilitados e as linhas continuam abrindo", async () => {
    let liberar: (r: Resposta) => void = () => {};
    banco.insercaoPendente = new Promise<Resposta>((r) => {
      liberar = r;
    });
    await montar();
    act(() => botaoPorTexto(TEXTOS_DA_CLIENTE.botaoExcluir)?.click());
    const dialogo = document.querySelector<HTMLElement>('[role="alertdialog"]');
    await act(async () => {
      botaoPorTexto(
        TEXTOS_DA_CLIENTE.confirmaExcluirAcao,
        dialogo as HTMLElement,
      )?.click();
    });
    expect(botaoPorTexto(TEXTOS_DA_CLIENTE.botaoExcluir)?.disabled).toBe(true);
    expect(botaoPorTexto(TEXTOS_DA_CLIENTE.botaoCorrigirEmail)?.disabled).toBe(
      true,
    );
    // Terminar com falha de rede mantém a pergunta aberta e libera os botões.
    await act(async () => {
      liberar({ data: null, error: { message: "TypeError: Failed to fetch" } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(botaoPorTexto(TEXTOS_DA_CLIENTE.botaoExcluir)?.disabled).toBe(false);
  });
});
