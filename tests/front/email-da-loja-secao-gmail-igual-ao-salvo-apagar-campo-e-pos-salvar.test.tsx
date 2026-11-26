// @vitest-environment jsdom
//
// Seção "E-mail da loja" (Ajustes) — bordas de estado que as provas vizinhas
// não pisam (hook dublado, como em email-da-loja-secao.test.tsx):
//  - Gmail digitado IGUAL ao salvo (só mudando a caixa das letras) não conta
//    como "mudou": nada fica por salvar (o campo de e-mail do navegador já tira
//    os espaços das pontas);
//  - o campo do Gmail pode ser APAGADO por inteiro (vazio é uma digitação, não
//    "não mexeu": o campo não volta sozinho para o Gmail salvo);
//  - a seção não rouba o foco na montagem;
//  - leitura "indisponível" ou com erro mostra o aviso mesmo com status em mãos;
//    status ausente com a leitura "pronta" também cai no aviso;
//  - depois de salvar com sucesso a tela fica no passo do teste (não volta ao
//    resumo) e o campo de senha some (a troca de senha acabou).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StatusDoEmail } from "@/components/admin/settings/email-da-loja-conteudo";
import type { UseEmailDaLoja } from "@/hooks/useEmailDaLoja";

const { hookFalso } = vi.hoisted(() => ({
  hookFalso: { atual: {} as UseEmailDaLoja },
}));
vi.mock("@/hooks/useEmailDaLoja", () => ({
  useEmailDaLoja: () => hookFalso.atual,
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/hooks/useDonoDaLoja", () => ({
  useDonoDaLoja: () => ({
    souODono: true,
    carregando: false,
    donoId: "dono-teste",
    leituraFalhou: false,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { EmailDaLojaSection } from "@/components/admin/settings/EmailDaLojaSection";

const SENHA_BOA = "abcdefghijklmnop";

const STATUS_SALVO: StatusDoEmail = {
  usuario: "loja@gmail.com",
  senhaGuardada: true,
  ultimoTeste: null,
  origem: "painel",
  cofrePronto: true,
  registroIlegivel: false,
  falha: null,
};

const fns = {
  salvar: vi.fn(),
  testar: vi.fn(),
  remover: vi.fn(),
  recarregar: vi.fn(),
};

function definirHook(parcial: Partial<UseEmailDaLoja>) {
  hookFalso.atual = {
    carga: "pronto",
    mensagemDeCarga: null,
    status: STATUS_SALVO,
    ocupado: null,
    recarregar: fns.recarregar,
    salvar: fns.salvar,
    testar: fns.testar,
    remover: fns.remover,
    ...parcial,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let dirtyVisto: boolean[] = [];

async function montar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await renderizar();
}
async function renderizar() {
  await act(async () => {
    raiz.render(
      <EmailDaLojaSection onDirtyMudou={(d) => dirtyVisto.push(d)} />,
    );
  });
}

const texto = () => hospedeiro.textContent ?? "";
const campo = (id: string) =>
  document.getElementById(id) as HTMLInputElement | null;

function digitar(id: string, valor: string) {
  const el = campo(id);
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function botao(rotulo: string): HTMLButtonElement | undefined {
  return [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(rotulo),
  );
}
async function clicar(rotulo: string) {
  const b = botao(rotulo);
  if (!b) throw new Error(`Botão "${rotulo}" não está na tela.`);
  await act(async () => {
    b.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("EmailDaLojaSection — Gmail igual ao salvo, campo apagado e pós-salvar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dirtyVisto = [];
    fns.salvar.mockResolvedValue({ ok: true });
    definirHook({});
  });
  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
    hospedeiro?.remove();
  });

  it("não rouba o foco na montagem (o foco só segue a troca de passo)", async () => {
    // Sem nada salvo o passo a passo já está na tela, com o título focável.
    definirHook({
      status: {
        ...STATUS_SALVO,
        usuario: null,
        senhaGuardada: false,
        origem: "nenhuma",
      },
    });
    await montar();
    expect(hospedeiro.querySelector("[data-titulo-do-passo]")).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
    await clicar("Já fiz, próximo passo");
    expect(document.activeElement).toBe(
      hospedeiro.querySelector("[data-titulo-do-passo]"),
    );
  });

  it("Gmail com outra caixa de letra, igual ao salvo: nada fica por salvar", async () => {
    await montar();
    await clicar("Trocar");
    expect(campo("email-loja-usuario")?.value).toBe("loja@gmail.com");
    digitar("email-loja-usuario", "LOJA@Gmail.com");
    expect(dirtyVisto.at(-1)).toBe(false);
    expect(texto()).not.toContain("Salve para testar");
  });

  it("Gmail realmente diferente: fica por salvar", async () => {
    await montar();
    await clicar("Trocar");
    digitar("email-loja-usuario", "outra@gmail.com");
    expect(dirtyVisto.at(-1)).toBe(true);
  });

  it("apagar o campo do Gmail por inteiro: o campo fica vazio (não volta ao salvo) e conta como mudança", async () => {
    await montar();
    await clicar("Trocar");
    digitar("email-loja-usuario", "");
    expect(campo("email-loja-usuario")?.value).toBe("");
    expect(dirtyVisto.at(-1)).toBe(true);
  });

  describe("leitura que não chegou", () => {
    it("indisponível, mesmo com status em mãos: aviso de status, sem botão de tentar de novo", async () => {
      definirHook({
        carga: "indisponivel",
        mensagemDeCarga: "Ainda não disponível nesta loja.",
      });
      await montar();
      const aviso = hospedeiro.querySelector('[data-estado="indisponivel"]');
      expect(aviso?.getAttribute("role")).toBe("status");
      expect(aviso?.textContent).toContain("Ainda não disponível nesta loja.");
      expect(botao("Tentar de novo")).toBeUndefined();
      expect(hospedeiro.querySelector("[data-selo]")).toBeNull();
    });

    it("erro, mesmo com status em mãos: alerta com 'Tentar de novo', que pede a leitura de novo", async () => {
      definirHook({ carga: "erro", mensagemDeCarga: "Não deu para ler." });
      await montar();
      const aviso = hospedeiro.querySelector('[data-estado="erro"]');
      expect(aviso?.getAttribute("role")).toBe("alert");
      expect(hospedeiro.querySelector("[data-selo]")).toBeNull();
      await clicar("Tentar de novo");
      expect(fns.recarregar).toHaveBeenCalledTimes(1);
    });

    it("pronta mas sem status: cai no aviso (nunca em tela vazia)", async () => {
      definirHook({ carga: "pronto", status: null as unknown as undefined });
      await montar();
      expect(hospedeiro.querySelector('[data-estado="pronto"]')).not.toBeNull();
      expect(hospedeiro.querySelector("[data-selo]")).toBeNull();
    });
  });

  describe("depois de salvar com sucesso", () => {
    it("Gmail novo salvo: a tela fica no passo do teste, sem voltar ao resumo, e a senha digitada some", async () => {
      // Começa sem nada salvo, no passo a passo.
      definirHook({
        status: {
          ...STATUS_SALVO,
          usuario: null,
          senhaGuardada: false,
          origem: "nenhuma",
        },
      });
      fns.salvar.mockImplementation(async () => {
        // o hook de verdade devolve o status novo (agora guardado)
        definirHook({});
        return { ok: true };
      });
      await montar();
      for (let i = 1; i < 4; i++) await clicar("Já fiz, próximo passo");
      digitar("email-loja-usuario", "loja@gmail.com");
      digitar("email-loja-senha", SENHA_BOA);
      await clicar("Salvar");
      expect(fns.salvar).toHaveBeenCalledWith("loja@gmail.com", SENHA_BOA);
      expect(
        hospedeiro
          .querySelector("section[data-passo]")
          ?.getAttribute("data-passo"),
      ).toBe("5");
      expect(texto()).not.toContain("Gmail da loja:");
      expect(botao("Trocar")).toBeUndefined();
    });

    it("troca de senha salva: continua no passo do teste e o campo de senha some", async () => {
      await montar();
      await clicar("Trocar");
      digitar("email-loja-senha", SENHA_BOA);
      expect(campo("email-loja-senha")).not.toBeNull();
      await clicar("Salvar");
      expect(fns.salvar).toHaveBeenCalledWith("loja@gmail.com", SENHA_BOA);
      expect(
        hospedeiro
          .querySelector("section[data-passo]")
          ?.getAttribute("data-passo"),
      ).toBe("5");
      // Voltando ao passo da senha: a troca acabou, então o campo não reaparece
      // (só o botão "Trocar" de novo).
      await clicar("Voltar");
      expect(
        hospedeiro
          .querySelector("section[data-passo]")
          ?.getAttribute("data-passo"),
      ).toBe("4");
      expect(campo("email-loja-senha")).toBeNull();
    });
  });
});
