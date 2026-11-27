// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), seção "E-mail da loja" (hook dublado, quem
// usa é o dono). Três regras de "o que a tela deixa fazer" que dependem do
// estado e que a suíte antiga não fechava:
//   Q1  o Gmail digitado só conta como "mudou" se for OUTRO endereço: maiúscula
//       e espaço em volta não são mudança (senão a seção acusa "não salvo" e
//       trava o teste à toa); outro endereço de verdade avisa o pai (para
//       bloquear o fecho) e pede a senha nova;
//   Q2  senha guardada mas ilegível (a origem diz "painel" mas o servidor não
//       consegue ler a senha) NÃO vale como senha em uso: sem resumo, sem teste
//       liberado, e a tela manda salvar de novo;
//   Q3  loja sem cofre (não guarda senha com segurança): só o aviso, mesmo com
//       um Gmail e uma senha que aparecem salvos — nada de resumo, nem botão de
//       trocar ou de testar.
// Gmail e senha FICTÍCIOS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MENSAGEM_SEM_COFRE,
  type StatusDoEmail,
} from "@/components/admin/settings/email-da-loja-conteudo";
import type { UseEmailDaLoja } from "@/hooks/useEmailDaLoja";

const { hookFalso, offlineFalso, donoFalso } = vi.hoisted(() => ({
  hookFalso: { atual: {} as UseEmailDaLoja },
  offlineFalso: { valor: false },
  donoFalso: { souODono: true, donoId: "dono-ficticio" as string | null },
}));
vi.mock("@/hooks/useEmailDaLoja", () => ({
  useEmailDaLoja: () => hookFalso.atual,
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => offlineFalso.valor,
}));
vi.mock("@/hooks/useDonoDaLoja", () => ({
  useDonoDaLoja: () => ({
    souODono: donoFalso.souODono,
    carregando: false,
    donoId: donoFalso.donoId,
    leituraFalhou: false,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { EmailDaLojaSection } from "@/components/admin/settings/EmailDaLojaSection";

const SALVO: StatusDoEmail = {
  usuario: "loja@gmail.com",
  senhaGuardada: true,
  ultimoTeste: { ok: true, em: "2026-11-24T10:00:00Z", motivo: null },
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
function definirStatus(
  status: StatusDoEmail,
  ocupado: UseEmailDaLoja["ocupado"] = null,
) {
  hookFalso.atual = {
    carga: "pronto",
    mensagemDeCarga: null,
    status,
    ocupado,
    recarregar: fns.recarregar,
    salvar: fns.salvar,
    testar: fns.testar,
    remover: fns.remover,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const avisosAoPai: boolean[] = [];

async function montar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(
      <EmailDaLojaSection onDirtyMudou={(d) => avisosAoPai.push(d)} />,
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

const botao = (rotulo: string) =>
  [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(rotulo),
  );

async function clicar(rotulo: string) {
  const b = botao(rotulo);
  if (!b) throw new Error(`Botão "${rotulo}" não está na tela.`);
  await act(async () => {
    b.click();
  });
}

async function irParaOPassoDeColar() {
  await clicar("Ver o passo a passo");
  for (let i = 0; i < 3; i++) await clicar("Já fiz, próximo passo");
}

beforeEach(() => {
  vi.clearAllMocks();
  avisosAoPai.length = 0;
  offlineFalso.valor = false;
  donoFalso.souODono = true;
  donoFalso.donoId = "dono-ficticio";
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("Q1 Gmail digitado: o que conta como 'mudou'", () => {
  it("o mesmo endereço com maiúscula e espaço em volta NÃO é mudança (nada de aviso, sem senha nova)", async () => {
    definirStatus(SALVO);
    await montar();
    await irParaOPassoDeColar();
    expect(campo("email-loja-usuario")?.value).toBe("loja@gmail.com");
    expect(campo("email-loja-senha")).toBeNull(); // senha guardada: sem campo

    digitar("email-loja-usuario", "  LOJA@Gmail.COM ");
    expect(avisosAoPai.at(-1)).toBe(false);
    expect(campo("email-loja-senha")).toBeNull();
  });

  it("outro endereço de verdade: avisa o pai e passa a pedir a senha de app; voltar ao original desfaz", async () => {
    definirStatus(SALVO);
    await montar();
    await irParaOPassoDeColar();

    digitar("email-loja-usuario", "outra@gmail.com");
    expect(avisosAoPai.at(-1)).toBe(true);
    expect(campo("email-loja-senha")).not.toBeNull();

    digitar("email-loja-usuario", "loja@gmail.com");
    expect(avisosAoPai.at(-1)).toBe(false);
    expect(campo("email-loja-senha")).toBeNull();
  });

  it("apagar o endereço também é mudança (não vira 'tudo igual')", async () => {
    definirStatus(SALVO);
    await montar();
    await irParaOPassoDeColar();
    digitar("email-loja-usuario", "");
    expect(avisosAoPai.at(-1)).toBe(true);
  });
});

describe("Q2 senha guardada mas ilegível não vale como senha em uso", () => {
  const ILEGIVEL: StatusDoEmail = {
    ...SALVO,
    senhaGuardada: false,
    registroIlegivel: true,
    ultimoTeste: null,
  };

  it("sem resumo de 'Senha guardada', com o passo a passo e o aviso para salvar de novo", async () => {
    definirStatus(ILEGIVEL);
    await montar();
    expect(texto()).toContain("Não consegui ler o Gmail e a senha");
    expect(texto()).not.toContain("Senha guardada");
    expect(botao("Trocar")).toBeUndefined();
    expect(botao("Salvar")).toBeUndefined(); // ainda no passo 1
    expect(texto()).toContain("Passo 1 de 5");
  });

  it("'Enviar e-mail de teste' fica travado e manda salvar antes", async () => {
    definirStatus(ILEGIVEL);
    await montar();
    for (let i = 0; i < 4; i++) await clicar("Já fiz, próximo passo");
    expect(texto()).toContain("Passo 5 de 5");
    expect(botao("Enviar e-mail de teste")?.disabled).toBe(true);
    expect(texto()).toContain("Salve o Gmail e a senha de app no passo 4");
  });

  it("origem 'painel' sem senha guardada nunca libera o teste, mesmo sem registro ilegível", async () => {
    definirStatus({ ...ILEGIVEL, registroIlegivel: false });
    await montar();
    for (let i = 0; i < 4; i++) await clicar("Já fiz, próximo passo");
    expect(botao("Enviar e-mail de teste")?.disabled).toBe(true);
  });

  it("senha guardada com origem do SERVIDOR também não é 'senha do painel em uso'", async () => {
    definirStatus({ ...SALVO, origem: "ambiente" });
    await montar();
    expect(texto()).not.toContain("Senha guardada");
    expect(botao("Trocar")).toBeUndefined();
  });
});

describe("Q3 loja sem cofre: só o aviso", () => {
  it("com Gmail e senha aparecendo salvos, mas sem cofre: aviso, sem resumo, sem passo a passo, sem testar", async () => {
    definirStatus({ ...SALVO, cofrePronto: false });
    await montar();
    expect(texto()).toContain(MENSAGEM_SEM_COFRE);
    expect(texto()).not.toContain("Senha guardada •");
    expect(texto()).not.toContain("Passo 1 de 5");
    expect(botao("Trocar")).toBeUndefined();
    expect(botao("Ver o passo a passo")).toBeUndefined();
  });

  it("sem cofre e SEM nada salvo: o passo a passo também não aparece", async () => {
    definirStatus({
      ...SALVO,
      cofrePronto: false,
      usuario: null,
      senhaGuardada: false,
      origem: "nenhuma",
      ultimoTeste: null,
    });
    await montar();
    expect(texto()).toContain(MENSAGEM_SEM_COFRE);
    expect(texto()).not.toContain("Passo 1 de 5");
  });
});

describe("Q4 depois de salvar, a tela volta a ser o que o servidor tem", () => {
  it("Gmail novo + senha salvos com sucesso: nada fica 'por salvar' (o pai é avisado de que está limpo)", async () => {
    definirStatus(SALVO);
    fns.salvar.mockResolvedValue({ ok: true });
    await montar();
    await irParaOPassoDeColar();
    digitar("email-loja-usuario", "outra@gmail.com");
    digitar("email-loja-senha", "abcdefghijklmnop");
    expect(avisosAoPai.at(-1)).toBe(true);

    await clicar("Salvar");
    expect(fns.salvar).toHaveBeenCalledWith(
      "outra@gmail.com",
      "abcdefghijklmnop",
    );
    expect(avisosAoPai.at(-1)).toBe(false);
  });
});

describe("Q5 'Enviar e-mail de teste' só com a seção livre", () => {
  it.each(["salvando", "testando", "removendo"] as const)(
    "enquanto a ação '%s' está em andamento o botão fica travado",
    async (ocupado) => {
      definirStatus(SALVO, ocupado);
      await montar();
      expect(botao("Enviar e-mail de teste")?.disabled).toBe(true);
    },
  );

  it("sem internet o botão fica travado; com internet e tudo livre, destravado", async () => {
    offlineFalso.valor = true;
    definirStatus(SALVO);
    await montar();
    expect(botao("Enviar e-mail de teste")?.disabled).toBe(true);
    act(() => raiz.unmount());
    hospedeiro.remove();

    offlineFalso.valor = false;
    await montar();
    expect(botao("Enviar e-mail de teste")?.disabled).toBe(false);
  });
});

describe("Q6 limite do servidor depois de um salvar recusado", () => {
  it("429 ao salvar com `espereSegundos`: o teste fica segurado e a contagem aparece (não some quando a lojista desfaz o que digitou)", async () => {
    definirStatus(SALVO);
    fns.salvar.mockResolvedValue({
      ok: false,
      mensagem: "Calma: dá para tentar de novo em 2 minutos.",
      espereSegundos: 90,
    });
    await montar();
    await clicar("Ver o passo a passo");
    for (let i = 0; i < 3; i++) await clicar("Já fiz, próximo passo");
    // Passo 4 com senha guardada: o campo da senha nasce atrás de "trocar".
    await clicar("trocar");
    digitar("email-loja-senha", "abcdefghijklmnop");
    await clicar("Salvar");
    expect(texto()).toContain("Calma: dá para tentar de novo em 2 minutos.");

    // Desfaz o que digitou: nada por salvar, mas o limite do servidor segue.
    digitar("email-loja-senha", "");
    expect(avisosAoPai.at(-1)).toBe(false);
    await clicar("Já fiz, próximo passo");
    expect(texto()).toContain("Passo 5 de 5");
    expect(texto()).toContain("Pode testar em 2 min");
    expect(botao("Enviar e-mail de teste")?.disabled).toBe(true);
  });
});

describe("Q7 remover: o que a tela faz depois da resposta", () => {
  const VAZIO: StatusDoEmail = {
    usuario: null,
    senhaGuardada: false,
    ultimoTeste: null,
    origem: "nenhuma",
    cofrePronto: true,
    registroIlegivel: false,
    falha: null,
  };

  // O Gmail da loja também é o canal da confirmação de cadastro e da
  // recuperação de senha (gancho de e-mail): a pergunta e o aviso dizem isso,
  // inclusive que a recuperação de senha da PRÓPRIA dona para.
  const PERGUNTA_DE_REMOVER =
    "A senha guardada é apagada. Se o servidor não tiver outra conta de e-mail, param de sair o e-mail do pedido, a confirmação de cadastro e a recuperação de senha, inclusive a sua. Se for trocar de Gmail, não remova: cadastre o novo, que ele entra no lugar deste sem parar os e-mails.";
  const AVISO_DEPOIS_DE_REMOVER =
    "Gmail removido. Se o servidor da loja tiver uma conta de e-mail própria, os e-mails voltam a sair por ela; se não, param o e-mail do pedido, a confirmação de cadastro e a recuperação de senha (inclusive a sua) até você cadastrar outro Gmail.";

  it("a pergunta de remover avisa que param o pedido, o cadastro e a recuperação de senha (inclusive a da dona), e o botão continua o mesmo", async () => {
    definirStatus(SALVO);
    await montar();
    await clicar("Remover o Gmail");
    expect(texto()).toContain(PERGUNTA_DE_REMOVER);
    expect(fns.remover).not.toHaveBeenCalled();
    await clicar("Sim, remover");
    expect(fns.remover).toHaveBeenCalledTimes(1);
  });

  it("o aviso depois de remover repete a verdade sobre cadastro e recuperação de senha", async () => {
    definirStatus(SALVO);
    fns.remover.mockImplementation(async () => {
      definirStatus(VAZIO);
      return { ok: true };
    });
    await montar();
    await clicar("Remover o Gmail");
    await clicar("Sim, remover");
    expect(texto()).toContain(AVISO_DEPOIS_DE_REMOVER);
  });

  it("remoção que FALHA fecha a pergunta 'Sim, remover' e mostra o motivo (não deixa o botão de confirmar pendurado)", async () => {
    definirStatus(SALVO);
    fns.remover.mockResolvedValue({
      ok: false,
      mensagem: "Não consegui falar com o servidor da loja agora.",
    });
    await montar();
    await clicar("Remover o Gmail");
    expect(botao("Sim, remover")).toBeDefined();
    await clicar("Sim, remover");
    expect(fns.remover).toHaveBeenCalledTimes(1);
    expect(botao("Sim, remover")).toBeUndefined();
    expect(texto()).toContain("Não consegui falar com o servidor da loja");
  });

  it("remoção que dá certo volta ao PASSO 1 e esquece o que estava digitado", async () => {
    definirStatus(SALVO);
    fns.remover.mockImplementation(async () => {
      definirStatus(VAZIO);
      return { ok: true };
    });
    await montar();
    // Abre o passo a passo no passo 4 e digita uma senha nova, sem salvar.
    await clicar("Ver o passo a passo");
    for (let i = 0; i < 3; i++) await clicar("Já fiz, próximo passo");
    await clicar("trocar");
    digitar("email-loja-senha", "abcdefghijklmnop");
    expect(avisosAoPai.at(-1)).toBe(true);

    await clicar("Remover o Gmail");
    await clicar("Sim, remover");
    expect(fns.remover).toHaveBeenCalledTimes(1);
    expect(texto()).toContain("Gmail removido");
    // Nada fica "por salvar" e o passo a passo recomeça do início.
    expect(avisosAoPai.at(-1)).toBe(false);
    expect(texto()).toContain("Passo 1 de 5");
  });
});

describe("Q8 navegação do passo a passo e dicas", () => {
  const VAZIO: StatusDoEmail = {
    usuario: null,
    senhaGuardada: false,
    ultimoTeste: null,
    origem: "nenhuma",
    cofrePronto: true,
    registroIlegivel: false,
    falha: null,
  };

  it("'Voltar' fica travado só no passo 1; 'Já fiz' some no último passo", async () => {
    definirStatus(VAZIO);
    await montar();
    expect(botao("Voltar")?.disabled).toBe(true);
    await clicar("Já fiz, próximo passo");
    expect(texto()).toContain("Passo 2 de 5");
    expect(botao("Voltar")?.disabled).toBe(false);
    for (let i = 0; i < 3; i++) await clicar("Já fiz, próximo passo");
    expect(texto()).toContain("Passo 5 de 5");
    expect(botao("Já fiz, próximo passo")).toBeUndefined();
  });

  it("último passo SEM senha salva: nem 'Já fiz' nem 'Concluir'; COM senha salva: 'Concluir' volta ao resumo", async () => {
    definirStatus(VAZIO);
    await montar();
    for (let i = 0; i < 4; i++) await clicar("Já fiz, próximo passo");
    expect(botao("Concluir")).toBeUndefined();
    act(() => raiz.unmount());
    hospedeiro.remove();

    definirStatus(SALVO);
    await montar();
    await clicar("Ver o passo a passo");
    for (let i = 0; i < 4; i++) await clicar("Já fiz, próximo passo");
    expect(botao("Concluir")).toBeDefined();
    await clicar("Concluir");
    expect(texto()).not.toContain("Passo 5 de 5");
    expect(texto()).toContain("Senha guardada");
  });

  it("digitou senha mas nada salvo ainda: a dica é 'salve o Gmail e a senha', nunca 'Salve para testar'", async () => {
    definirStatus(VAZIO);
    await montar();
    for (let i = 0; i < 3; i++) await clicar("Já fiz, próximo passo");
    digitar("email-loja-usuario", "loja@gmail.com");
    digitar("email-loja-senha", "abcdefghijklmnop");
    await clicar("Já fiz, próximo passo");
    expect(texto()).toContain("Passo 5 de 5");
    expect(texto()).toContain("Salve o Gmail e a senha de app no passo 4");
    expect(texto()).not.toContain("Salve para testar");
  });

  it("'Salvar' fica travado enquanto uma ação está em andamento", async () => {
    definirStatus(VAZIO, "salvando");
    await montar();
    for (let i = 0; i < 3; i++) await clicar("Já fiz, próximo passo");
    expect(botao("Salvar")?.disabled).toBe(true);
  });
});

describe("Q9 erros de carga e remoção sem internet", () => {
  it("falha de carga 'erro': alerta com 'Tentar de novo' que recarrega; 'indisponível': só o aviso, sem botão", async () => {
    hookFalso.atual = {
      carga: "erro",
      mensagemDeCarga: "Não consegui falar com o servidor da loja agora.",
      status: null,
      ocupado: null,
      recarregar: fns.recarregar,
      salvar: fns.salvar,
      testar: fns.testar,
      remover: fns.remover,
    };
    await montar();
    expect(hospedeiro.querySelector("[role=alert]")).not.toBeNull();
    await clicar("Tentar de novo");
    expect(fns.recarregar).toHaveBeenCalledTimes(1);
    act(() => raiz.unmount());
    hospedeiro.remove();

    hookFalso.atual = {
      ...hookFalso.atual,
      carga: "indisponivel",
      mensagemDeCarga: "Este recurso ainda não está disponível nesta loja.",
    };
    await montar();
    expect(botao("Tentar de novo")).toBeUndefined();
    expect(hospedeiro.querySelector("[role=status]")).not.toBeNull();
    expect(hospedeiro.querySelector("[role=alert]")).toBeNull();
  });

  it("sem internet, o 'Sim, remover' fica travado (a pergunta ainda abre)", async () => {
    offlineFalso.valor = true;
    definirStatus(SALVO);
    await montar();
    await clicar("Remover o Gmail");
    expect(botao("Sim, remover")?.disabled).toBe(true);
  });

  it("loja sem cofre mas com registro guardado: a remoção que falha mostra o motivo no bloco de remover", async () => {
    definirStatus({ ...SALVO, cofrePronto: false });
    fns.remover.mockResolvedValue({
      ok: false,
      mensagem: "Não consegui falar com o servidor da loja agora.",
    });
    await montar();
    await clicar("Remover o Gmail");
    await clicar("Sim, remover");
    expect(texto()).toContain("Não consegui falar com o servidor da loja");
  });
});

describe("Q10 administrador nomeado (não é o dono) no passo a passo", () => {
  it("o link 'trocar' da senha guardada (passo 4) também fica travado, com a frase do dono", async () => {
    donoFalso.souODono = false;
    donoFalso.donoId = "outra-pessoa-ficticia";
    definirStatus(SALVO);
    await montar();
    await clicar("Ver o passo a passo");
    for (let i = 0; i < 3; i++) await clicar("Já fiz, próximo passo");
    expect(texto()).toContain("Só o dono da loja troca o e-mail da loja.");
    expect(botao("trocar")?.disabled).toBe(true);
    expect(campo("email-loja-usuario")?.disabled).toBe(true);
  });

  it("o dono vê o mesmo link 'trocar' destravado", async () => {
    definirStatus(SALVO);
    await montar();
    await clicar("Ver o passo a passo");
    for (let i = 0; i < 3; i++) await clicar("Já fiz, próximo passo");
    expect(botao("trocar")?.disabled).toBe(false);
  });
});
