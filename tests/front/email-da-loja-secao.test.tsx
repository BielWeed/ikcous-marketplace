// @vitest-environment jsdom
//
// A seção "E-mail da loja" na tela (14/10/2026), com o HOOK DUBLADO (o hook em
// si é provado em email-da-loja-hook.test.tsx; a ponta a ponta com o hook de
// verdade, em email-da-loja-secao-integrada.test.tsx). O que prova:
//   T1  selo de estado: "Funcionando" / "Salvo, ainda não testado" /
//       "Não configurado — … NÃO recebem" / "Configurado no servidor";
//   T2  saúde do envio: "Seus e-mails pararam em DD/MM — …";
//   T3  cofre falso: aviso ANTES de tudo, sem passo a passo e sem campos;
//   T4  função ausente nesta loja: frase de "ainda não disponível", sem quebrar;
//   T5  uma etapa por vez, com links externos seguros;
//   T6  campo da senha: type=password, new-password, nunca preenchido de volta,
//       validação sem recusar colagem boa, limpo depois de salvar;
//   T7  erro do servidor vira o aviso que o hook devolveu (frase da casa);
//   T8  "Enviar e-mail de teste" só depois de salvo e sem nada por salvar;
//   T9  "Remover" pede confirmação;
//   T10 acessibilidade: rótulos ligados aos campos, foco no título do passo,
//       avisos em regiões que o leitor de tela anuncia.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StatusDoEmail } from "@/components/admin/settings/email-da-loja-conteudo";
import type { UseEmailDaLoja } from "@/hooks/useEmailDaLoja";

const { hookFalso, offlineFalso } = vi.hoisted(() => ({
  hookFalso: { atual: {} as UseEmailDaLoja },
  offlineFalso: { valor: false },
}));
vi.mock("@/hooks/useEmailDaLoja", () => ({
  useEmailDaLoja: () => hookFalso.atual,
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => offlineFalso.valor,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { EmailDaLojaSection } from "@/components/admin/settings/EmailDaLojaSection";

const SENHA_BOA = "abcdefghijklmnop";

const STATUS_VAZIO: StatusDoEmail = {
  usuario: null,
  senhaGuardada: false,
  ultimoTeste: null,
  origem: "nenhuma",
  cofrePronto: true,
  registroIlegivel: false,
  falha: null,
};
const STATUS_SALVO: StatusDoEmail = {
  ...STATUS_VAZIO,
  usuario: "loja@gmail.com",
  senhaGuardada: true,
  origem: "painel",
};
const TESTE_OK = {
  ok: true,
  em: "2026-10-14T12:00:00Z",
  motivo: null,
} as const;

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
    status: STATUS_VAZIO,
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
const dirtyVisto: boolean[] = [];

async function montar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(
      <EmailDaLojaSection onDirtyMudou={(d) => dirtyVisto.push(d)} />,
    );
  });
}

const texto = () => hospedeiro.textContent ?? "";

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
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

async function irParaPasso(n: number) {
  for (let i = 1; i < n; i++) await clicar("Já fiz, próximo passo");
}

describe("EmailDaLojaSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dirtyVisto.length = 0;
    offlineFalso.valor = false;
    fns.salvar.mockResolvedValue({ ok: true });
    fns.testar.mockResolvedValue({ ok: true });
    fns.remover.mockResolvedValue({ ok: true });
    definirHook({});
  });
  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
    hospedeiro?.remove();
  });

  describe("T1 — o selo de estado", () => {
    it("nada cadastrado: 'Não configurado' e avisa que o cliente NÃO recebe e-mail do pedido", async () => {
      await montar();
      const selo = hospedeiro.querySelector("[data-selo]");
      expect(selo?.getAttribute("data-selo")).toBe("nao_configurado");
      expect(selo?.textContent).toContain("Não configurado");
      expect(selo?.textContent).toContain("NÃO recebem e-mail do pedido");
    });

    it("origem servidor: 'Configurado no servidor'", async () => {
      definirHook({ status: { ...STATUS_VAZIO, origem: "ambiente" } });
      await montar();
      expect(hospedeiro.querySelector("[data-selo]")?.textContent).toContain(
        "Configurado no servidor",
      );
    });

    it("salvo sem teste: 'Salvo, ainda não testado' — e NUNCA 'Funcionando'", async () => {
      definirHook({ status: STATUS_SALVO });
      await montar();
      const selo = hospedeiro.querySelector("[data-selo]");
      expect(selo?.getAttribute("data-selo")).toBe("salvo_sem_teste");
      expect(selo?.textContent).toContain("Salvo, ainda não testado");
      expect(texto()).not.toContain("Funcionando");
    });

    it("teste aprovado: 'Funcionando', dizendo que é o login e que o e-mail de teste prova o resto", async () => {
      definirHook({ status: { ...STATUS_SALVO, ultimoTeste: TESTE_OK } });
      await montar();
      const selo = hospedeiro.querySelector("[data-selo]");
      expect(selo?.getAttribute("data-selo")).toBe("funcionando");
      expect(selo?.textContent).toContain("Funcionando");
      expect(selo?.textContent).toContain("Google aceitou o login");
      expect(selo?.textContent).toContain("Enviar e-mail de teste");
    });

    it("T2 — falha recente do envio: 'Seus e-mails pararam em 13/10 — o Google recusou a senha'", async () => {
      definirHook({
        status: {
          ...STATUS_SALVO,
          ultimoTeste: { ok: true, em: "2026-10-01T12:00:00Z", motivo: null },
          falha: {
            em: "2026-10-13T15:00:00Z",
            motivo: "senha_errada",
            origem: "painel",
          },
        },
      });
      await montar();
      const aviso = hospedeiro.querySelector("[data-saude]");
      expect(aviso?.textContent).toContain(
        "Seus e-mails pararam em 13/10 — o Google recusou a senha.",
      );
      expect(aviso?.getAttribute("role")).toBe("alert");
      expect(
        hospedeiro.querySelector("[data-selo]")?.getAttribute("data-selo"),
      ).toBe("problema");
    });

    it("registro guardado que não dá para ler: pede para salvar de novo e mostra o passo a passo", async () => {
      definirHook({
        status: {
          ...STATUS_VAZIO,
          senhaGuardada: true,
          registroIlegivel: true,
          usuario: "loja@gmail.com",
        },
      });
      await montar();
      expect(texto()).toContain("Não consegui ler");
      // o passo a passo está de pé (a senha guardada não vale: é preciso salvar de novo)
      expect(texto()).toContain("Passo 1 de 5");
      await irParaPasso(4);
      expect(document.getElementById("email-loja-senha")).not.toBeNull();
    });
  });

  describe("T3 — loja sem cofre", () => {
    it("avisa ANTES do passo a passo e não mostra passos nem campos", async () => {
      definirHook({ status: { ...STATUS_VAZIO, cofrePronto: false } });
      await montar();
      const aviso = hospedeiro.querySelector("[data-cofre-falso]");
      expect(aviso?.textContent).toContain(
        "ainda não está preparada para guardar a senha",
      );
      expect(aviso?.textContent).toContain("Fale com o suporte");
      expect(texto()).not.toContain("Passo 1 de");
      expect(texto()).not.toContain("Use um Gmail só da loja");
      expect(document.getElementById("email-loja-senha")).toBeNull();
      expect(document.getElementById("email-loja-usuario")).toBeNull();
      expect(hospedeiro.querySelector("a[href*='google.com']")).toBeNull();
    });
  });

  describe("T4 — função ausente ou fora do ar", () => {
    it("indisponível: frase da casa, sem passo a passo, e não quebra", async () => {
      definirHook({
        carga: "indisponivel",
        status: null,
        mensagemDeCarga:
          "Este recurso ainda não está disponível nesta loja. Fale com o suporte.",
      });
      await montar();
      expect(texto()).toContain(
        "Este recurso ainda não está disponível nesta loja",
      );
      expect(hospedeiro.querySelector("[data-selo]")).toBeNull();
      expect(document.getElementById("email-loja-senha")).toBeNull();
    });

    it("erro ao carregar: aviso e 'Tentar de novo'", async () => {
      definirHook({
        carga: "erro",
        status: null,
        mensagemDeCarga:
          "Algo saiu do previsto no servidor. Tente de novo em instantes.",
      });
      await montar();
      expect(texto()).toContain("Tente de novo em instantes");
      await clicar("Tentar de novo");
      expect(fns.recarregar).toHaveBeenCalledTimes(1);
    });

    it("carregando: avisa que está lendo", async () => {
      definirHook({ carga: "carregando", status: null });
      await montar();
      expect(texto()).toContain("Lendo");
      expect(hospedeiro.querySelector("[data-selo]")).toBeNull();
    });
  });

  describe("T5 — uma etapa por vez", () => {
    it("só o passo atual aparece, e 'Já fiz, próximo passo' avança", async () => {
      await montar();
      expect(texto()).toContain("Passo 1 de 5");
      expect(texto()).toContain("Use um Gmail só da loja");
      expect(texto()).not.toContain("Ligue a verificação em duas etapas");
      await clicar("Já fiz, próximo passo");
      expect(texto()).toContain("Passo 2 de 5");
      expect(texto()).toContain("Ligue a verificação em duas etapas");
      expect(texto()).not.toContain("Use um Gmail só da loja");
      await clicar("Voltar");
      expect(texto()).toContain("Passo 1 de 5");
    });

    it("cada passo diz o que fazer, o que aparece, como saber que deu certo e o que fazer se for diferente", async () => {
      await montar();
      for (let n = 1; n <= 5; n++) {
        expect(texto()).toContain(`Passo ${n} de 5`);
        expect(texto()).toContain("O que vai aparecer");
        expect(texto()).toContain("Deu certo quando");
        expect(texto()).toContain("Se aparecer diferente");
        if (n < 5) await clicar("Já fiz, próximo passo");
      }
    });

    it("links do Google abrem em outra aba, com rel seguro", async () => {
      await montar();
      await irParaPasso(3);
      const link = hospedeiro.querySelector(
        "a[href='https://myaccount.google.com/apppasswords']",
      ) as HTMLAnchorElement | null;
      expect(link).not.toBeNull();
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
      for (const a of hospedeiro.querySelectorAll("a[href^='http']")) {
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      }
    });

    it("T10 — o foco vai para o título do passo novo", async () => {
      await montar();
      await clicar("Já fiz, próximo passo");
      const titulo = hospedeiro.querySelector("[data-titulo-do-passo]");
      expect(titulo).not.toBeNull();
      expect(document.activeElement).toBe(titulo);
    });

    it("o passo 3 explica quando a opção de senha de app NÃO aparece", async () => {
      await montar();
      await irParaPasso(3);
      expect(texto()).toContain("chave de segurança");
      expect(texto()).toContain("Proteção Avançada");
    });
  });

  describe("T6 — o campo da senha", () => {
    it("é type=password, new-password, sem correção automática, e nasce vazio", async () => {
      await montar();
      await irParaPasso(4);
      const campo = document.getElementById(
        "email-loja-senha",
      ) as HTMLInputElement;
      expect(campo.type).toBe("password");
      expect(campo.getAttribute("autocomplete")).toBe("new-password");
      expect(campo.getAttribute("autocapitalize")).toBe("none");
      expect(campo.getAttribute("spellcheck")).toBe("false");
      expect(campo.value).toBe("");
    });

    it("salvar manda o Gmail em minúsculas e a senha SÓ com as 16 letras (colagem com espaço que não quebra e maiúsculas)", async () => {
      await montar();
      await irParaPasso(4);
      digitar("email-loja-usuario", "  Loja@Gmail.com ");
      digitar("email-loja-senha", "ABCD\u00a0EFGH ijkl mnop");
      await clicar("Salvar");
      expect(fns.salvar).toHaveBeenCalledTimes(1);
      expect(fns.salvar).toHaveBeenCalledWith("loja@gmail.com", SENHA_BOA);
    });

    it("senha que não tem 16 letras: avisa, não manda e não repete o que foi digitado", async () => {
      await montar();
      await irParaPasso(4);
      digitar("email-loja-usuario", "loja@gmail.com");
      digitar("email-loja-senha", "minhaSenhaNormal123");
      await clicar("Salvar");
      expect(fns.salvar).not.toHaveBeenCalled();
      expect(texto()).toContain("16 letras");
      expect(texto()).not.toContain("minhaSenhaNormal123");
    });

    it("Gmail inválido: avisa e não manda", async () => {
      await montar();
      await irParaPasso(4);
      digitar("email-loja-usuario", "loja@outlook.com");
      digitar("email-loja-senha", SENHA_BOA);
      await clicar("Salvar");
      expect(fns.salvar).not.toHaveBeenCalled();
      expect(texto()).toContain("@gmail.com");
    });

    it("depois de salvar com sucesso: o campo é LIMPO e some, mostra 'Senha guardada' e a senha não está em lugar nenhum da tela", async () => {
      fns.salvar.mockImplementation(async () => {
        definirHook({ status: { ...STATUS_SALVO, ultimoTeste: TESTE_OK } });
        return { ok: true };
      });
      await montar();
      await irParaPasso(4);
      digitar("email-loja-usuario", "loja@gmail.com");
      digitar("email-loja-senha", SENHA_BOA);
      await clicar("Salvar");
      expect(fns.salvar).toHaveBeenCalledTimes(1);
      expect(texto()).toContain("Senha guardada");
      // a senha não está em nenhum texto nem em nenhum campo
      expect(texto()).not.toContain(SENHA_BOA);
      for (const campo of hospedeiro.querySelectorAll("input")) {
        expect(campo.value).not.toContain(SENHA_BOA);
      }
      // e o que ficou por salvar acabou: a trava de fechar a seção solta
      expect(dirtyVisto.at(-1)).toBe(false);
    });

    it("com senha já guardada: 'Senha guardada • Trocar' e o campo NÃO vem preenchido", async () => {
      definirHook({ status: { ...STATUS_SALVO, ultimoTeste: TESTE_OK } });
      await montar();
      expect(texto()).toContain("Senha guardada");
      expect(document.getElementById("email-loja-senha")).toBeNull();
      await clicar("Trocar");
      const campo = document.getElementById(
        "email-loja-senha",
      ) as HTMLInputElement;
      expect(campo).not.toBeNull();
      expect(campo.value).toBe("");
      expect(campo.type).toBe("password");
    });

    it("a trava de 'salve antes de fechar' liga quando há senha digitada e solta quando se apaga", async () => {
      await montar();
      await irParaPasso(4);
      digitar("email-loja-senha", "abc");
      await act(async () => {});
      expect(dirtyVisto.at(-1)).toBe(true);
      digitar("email-loja-senha", "");
      await act(async () => {});
      expect(dirtyVisto.at(-1)).toBe(false);
    });

    it("sem internet: o salvar fica travado, com o motivo à vista", async () => {
      offlineFalso.valor = true;
      await montar();
      await irParaPasso(4);
      expect(botao("Salvar")?.disabled).toBe(true);
      expect(texto()).toContain("Sem conexão");
    });
  });

  describe("T7 — o erro vira aviso humano", () => {
    it("falha ao salvar: mostra a frase que o hook devolveu, em região de alerta, e NÃO limpa o que foi digitado", async () => {
      fns.salvar.mockResolvedValue({
        ok: false,
        mensagem:
          "O Google bloqueou o acesso vindo do servidor. Abra o Gmail dessa conta, procure o alerta de segurança e toque em «Fui eu»; depois tente de novo.",
      });
      await montar();
      await irParaPasso(4);
      digitar("email-loja-usuario", "loja@gmail.com");
      digitar("email-loja-senha", SENHA_BOA);
      await clicar("Salvar");
      const alerta = hospedeiro.querySelector("[data-resultado][role='alert']");
      expect(alerta?.textContent).toContain("Fui eu");
      // continua no passo 4 para ela tentar de novo
      expect(texto()).toContain("Passo 4 de 5");
    });
  });

  describe("T8 — o e-mail de teste", () => {
    it("sem nada salvo: o botão existe no passo 5 mas está DESABILITADO, e diz por quê", async () => {
      await montar();
      await irParaPasso(5);
      const b = botao("Enviar e-mail de teste");
      expect(b).toBeDefined();
      expect(b?.disabled).toBe(true);
      expect(texto()).toContain("Salve o Gmail e a senha");
      await clicar("Enviar e-mail de teste");
      expect(fns.testar).not.toHaveBeenCalled();
    });

    it("com algo digitado e não salvo: o botão do teste fica desabilitado (testaria outra coisa)", async () => {
      definirHook({ status: STATUS_SALVO });
      await montar();
      await clicar("Trocar");
      digitar("email-loja-senha", "abcd");
      await act(async () => {});
      await clicar("Já fiz, próximo passo");
      expect(botao("Enviar e-mail de teste")?.disabled).toBe(true);
    });

    it("salvo: testa, e o sucesso diz onde achar o e-mail (ENVIADOS e Spam)", async () => {
      definirHook({ status: STATUS_SALVO });
      await montar();
      expect(botao("Enviar e-mail de teste")?.disabled).toBe(false);
      await clicar("Enviar e-mail de teste");
      expect(fns.testar).toHaveBeenCalledTimes(1);
      const ok = hospedeiro.querySelector("[data-resultado]");
      expect(ok?.getAttribute("role")).toBe("status");
      expect(ok?.textContent).toContain("ENVIADOS");
      expect(ok?.textContent).toContain("Spam");
    });

    it("teste que falha: mostra a frase da casa em alerta", async () => {
      fns.testar.mockResolvedValue({
        ok: false,
        mensagem:
          "O Google recusou a senha. Confira se você colou a senha de APP.",
      });
      definirHook({ status: STATUS_SALVO });
      await montar();
      await clicar("Enviar e-mail de teste");
      const aviso = hospedeiro.querySelector("[data-resultado]");
      expect(aviso?.getAttribute("role")).toBe("alert");
      expect(aviso?.textContent).toContain("recusou a senha");
    });
  });

  describe("T9 — remover pede confirmação", () => {
    it("o primeiro clique só pergunta; só 'Sim, remover' chama o servidor; 'Cancelar' desiste", async () => {
      definirHook({ status: STATUS_SALVO });
      await montar();
      await clicar("Remover");
      expect(fns.remover).not.toHaveBeenCalled();
      expect(texto()).toContain("Sim, remover");
      await clicar("Cancelar");
      expect(fns.remover).not.toHaveBeenCalled();
      expect(botao("Sim, remover")).toBeUndefined();
      await clicar("Remover");
      await clicar("Sim, remover");
      expect(fns.remover).toHaveBeenCalledTimes(1);
    });

    it("sem nada guardado, não há botão de remover", async () => {
      await montar();
      expect(botao("Remover")).toBeUndefined();
    });

    it("loja sem cofre mas com registro guardado: ainda dá para remover", async () => {
      definirHook({ status: { ...STATUS_SALVO, cofrePronto: false } });
      await montar();
      expect(botao("Remover")).toBeDefined();
    });
  });

  describe("T10 — acessibilidade e layout", () => {
    it("cada campo tem rótulo ligado (label for) e o erro de validação fica ligado ao campo", async () => {
      await montar();
      await irParaPasso(4);
      for (const id of ["email-loja-usuario", "email-loja-senha"]) {
        const rotulo = hospedeiro.querySelector(`label[for='${id}']`);
        expect(rotulo?.textContent?.length).toBeGreaterThan(3);
      }
      digitar("email-loja-usuario", "loja@gmail.com");
      digitar("email-loja-senha", "curta");
      await clicar("Salvar");
      const campo = document.getElementById(
        "email-loja-senha",
      ) as HTMLInputElement;
      expect(campo.getAttribute("aria-invalid")).toBe("true");
      const idDoErro = campo.getAttribute("aria-describedby");
      expect(idDoErro).toBeTruthy();
      expect(
        document.getElementById(idDoErro as string)?.textContent,
      ).toContain("16 letras");
    });

    it("o selo é uma região de status e o Gmail longo quebra linha (sem rolagem lateral a 360px)", async () => {
      definirHook({
        status: {
          ...STATUS_SALVO,
          usuario: "um.nome.de.loja.muito.comprido.mesmo@gmail.com",
        },
      });
      await montar();
      expect(
        hospedeiro.querySelector("[data-selo]")?.getAttribute("role"),
      ).toBe("status");
      const gmail = [...hospedeiro.querySelectorAll("strong")].find((e) =>
        e.textContent?.includes("um.nome.de.loja"),
      );
      expect(gmail?.className).toContain("break-all");
    });
  });
});
