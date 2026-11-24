// @vitest-environment jsdom
//
// "Privacidade e meus dados": o que a tela PROMETE contra o que o botão FAZ, nos cantos que os testes vizinhos
// (privacidade-e-meus-dados, privacidade-rede-lenta-e-envio, privacidade-sanfona-tinta) não pisam:
//   - o prazo de resposta ("em até N dias") vem da MESMA constante em todos os lugares onde a tela o promete
//     (cartão do prazo, pergunta de exclusão, pergunta do e-mail, "pedido enviado");
//   - cada tipo de falha (sessão acabou, erro do servidor, sem rede, pedido duplicado) mostra o seu texto,
//     nas DUAS perguntas, e só o duplicado fecha a pergunta;
//   - reabrir a pergunta não herda a falha nem o e-mail inválido da vez anterior;
//   - enquanto o pedido é gravado, a pergunta não deixa cancelar nem confirmar de novo;
//   - e-mail já atendido ou recusado deixa pedir outra correção; exclusão atendida encerra.
// Dados inventados (*.invalid): nenhum dado real de cliente.
import { PrivacidadeEMeusDados } from "@/components/account/PrivacidadeEMeusDados";
import {
  PRAZO_DE_RESPOSTA_EM_DIAS,
  fraseDeItens,
} from "@/config/textos-de-privacidade";
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

const USER_ID = "cliente-falhas-1";
const EMAIL_ATUAL = "atual@exemplo.invalid";

interface Resposta {
  data: unknown;
  error: unknown;
}

const banco = vi.hoisted(() => ({
  lista: { data: [], error: null } as Resposta,
  listaDepois: null as Resposta | null,
  leituras: 0,
  inserts: [] as Array<Record<string, unknown>>,
  // Cada insert consome a próxima função (ou resolve `padrao`).
  proximas: [] as Array<() => Promise<Resposta>>,
  padrao: { data: null, error: null } as Resposta,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => {
            banco.leituras += 1;
            if (banco.leituras > 1 && banco.listaDepois) {
              return banco.listaDepois;
            }
            return banco.lista;
          },
        }),
      }),
      insert: (linha: Record<string, unknown>) => {
        banco.inserts.push(linha);
        return {
          select: () => ({
            single: () => {
              const proxima = banco.proximas.shift();
              return proxima ? proxima() : Promise.resolve(banco.padrao);
            },
          }),
        };
      },
    }),
  },
}));

function pedido(extra: Record<string, unknown> = {}) {
  return {
    id: "ped-1",
    user_id: USER_ID,
    tipo: "excluir_conta",
    email_novo: null,
    situacao: "aberto",
    criado_em: "2026-11-02T12:00:00Z",
    atendido_em: null,
    observacao: null,
    ...extra,
  };
}

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const corpo = () => document.body.textContent ?? "";
const dialogo = () =>
  document.body.querySelector<HTMLElement>('[role="alertdialog"]');
const botao = (texto: string, dentro: ParentNode = document.body) =>
  [...dentro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    (b.textContent ?? "").includes(texto),
  );
const campoDoEmail = () =>
  document.getElementById("privacidade-email-novo") as HTMLInputElement;

function digitar(campo: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

type Tipo = "excluir_conta" | "corrigir_email";

const FLUXOS: Array<{
  tipo: Tipo;
  abrir: string;
  confirmar: string;
}> = [
  {
    tipo: "excluir_conta",
    abrir: "Pedir exclusão da minha conta",
    confirmar: "Sim, pedir exclusão",
  },
  {
    tipo: "corrigir_email",
    abrir: "Corrigir meu e-mail",
    confirmar: "Enviar pedido",
  },
];

describe("PrivacidadeEMeusDados: falhas, prazo e reabertura", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    banco.lista = { data: [], error: null };
    banco.listaDepois = null;
    banco.leituras = 0;
    banco.inserts = [];
    banco.proximas = [];
    banco.padrao = { data: null, error: null };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  async function montar() {
    act(() => {
      raiz.render(
        <PrivacidadeEMeusDados userId={USER_ID} emailAtual={EMAIL_ATUAL} />,
      );
    });
    await assentar();
  }

  async function abrirEConfirmar(fluxo: (typeof FLUXOS)[number]) {
    act(() => botao(fluxo.abrir)?.click());
    if (fluxo.tipo === "corrigir_email") {
      digitar(campoDoEmail(), "novo@exemplo.invalid");
    }
    await act(async () => {
      botao(fluxo.confirmar, dialogo() as HTMLElement)?.click();
    });
    await assentar();
  }

  describe("o prazo prometido é sempre a mesma constante", () => {
    it("cartão do prazo, pergunta de exclusão, pergunta do e-mail e 'pedido enviado' dizem o mesmo número de dias", async () => {
      const frase = `até ${PRAZO_DE_RESPOSTA_EM_DIAS} dias`;
      await montar();
      // Cartão do prazo (fora de qualquer pergunta).
      expect(hospedeiro.textContent).toContain(`responde em ${frase}`);

      act(() => botao("Pedir exclusão da minha conta")?.click());
      expect(dialogo()?.textContent).toContain(`responder em ${frase}`);
      act(() => botao("Voltar", dialogo() as HTMLElement)?.click());
      await assentar();

      act(() => botao("Corrigir meu e-mail")?.click());
      expect(dialogo()?.textContent).toContain(`responde em ${frase}`);
      act(() => botao("Voltar", dialogo() as HTMLElement)?.click());
      await assentar();

      // Pedido já aberto na carga: a frase do "pedido enviado".
      act(() => raiz.unmount());
      banco.lista = { data: [pedido()], error: null };
      banco.leituras = 0;
      raiz = createRoot(hospedeiro);
      await montar();
      expect(hospedeiro.textContent).toContain(`responde em ${frase}`);
    });

    it("o resumo da lista 'o que a exclusão apaga' singulariza só quando há exatamente um item", () => {
      expect(fraseDeItens(1)).toBe("1 item");
      expect(fraseDeItens(2)).toBe("2 itens");
      expect(fraseDeItens(7)).toBe("7 itens");
      expect(fraseDeItens(0)).toBe("0 itens");
    });
  });

  describe.each(FLUXOS)("falhas na pergunta de $tipo", (fluxo) => {
    it.each([
      [
        "sessão vencida (42501)",
        { code: "42501", message: "rls" },
        "Sua sessão acabou.",
      ],
      [
        "erro desconhecido do servidor",
        { code: "40001", message: "x" },
        "Não foi possível enviar o pedido agora.",
      ],
      [
        "sem código (rede)",
        { message: "TypeError: Failed to fetch" },
        "Sem conexão agora.",
      ],
    ])(
      "%s: mostra o texto certo DENTRO da pergunta, mantém ela aberta e não finge que enviou",
      async (_nome, erro, texto) => {
        banco.padrao = { data: null, error: erro };
        await montar();
        await abrirEConfirmar(fluxo);
        expect(dialogo()).not.toBeNull();
        expect(dialogo()?.textContent).toContain(texto);
        expect(dialogo()?.querySelectorAll('[role="alert"]').length).toBe(1);
        // O aviso não aparece também atrás da pergunta (duplicaria o alerta para o leitor de tela).
        expect(hospedeiro.textContent).not.toContain(texto);
        expect(corpo()).not.toContain("Pedido enviado em");
      },
    );

    it("pedido duplicado (23505): fecha a pergunta e mostra o aviso FORA dela, com o pedido que já existe", async () => {
      banco.padrao = { data: null, error: { code: "23505", message: "dup" } };
      banco.listaDepois = {
        data: [
          pedido({
            tipo: fluxo.tipo,
            email_novo:
              fluxo.tipo === "corrigir_email" ? "novo@exemplo.invalid" : null,
          }),
        ],
        error: null,
      };
      await montar();
      await abrirEConfirmar(fluxo);
      expect(dialogo()).toBeNull();
      expect(hospedeiro.textContent).toContain(
        "Você já tem um pedido igual esperando resposta",
      );
      expect(hospedeiro.textContent).toContain("Pedido enviado em");
    });

    it("reabrir a pergunta depois de uma falha NÃO herda o aviso da vez anterior", async () => {
      banco.padrao = { data: null, error: { code: "40001", message: "x" } };
      await montar();
      await abrirEConfirmar(fluxo);
      expect(dialogo()?.textContent).toContain("Não foi possível enviar");
      act(() => botao("Voltar", dialogo() as HTMLElement)?.click());
      await assentar();
      expect(dialogo()).toBeNull();
      // Fechada, a falha também não fica solta na tela.
      expect(corpo()).not.toContain("Não foi possível enviar");

      act(() => botao(fluxo.abrir)?.click());
      expect(dialogo()).not.toBeNull();
      expect(dialogo()?.textContent).not.toContain("Não foi possível enviar");
    });

    it("o aviso de 'já existe' do OUTRO tipo não aparece dentro da pergunta que se abre em seguida", async () => {
      const outro = FLUXOS.find((f) => f.tipo !== fluxo.tipo);
      if (!outro) throw new Error("os fluxos de teste têm dois tipos");
      // Pedir este tipo bate no pedido que já existe (23505) e fecha a pergunta com o aviso na tela.
      banco.padrao = { data: null, error: { code: "23505", message: "dup" } };
      banco.listaDepois = {
        data: [
          pedido({
            tipo: fluxo.tipo,
            email_novo:
              fluxo.tipo === "corrigir_email" ? "novo@exemplo.invalid" : null,
          }),
        ],
        error: null,
      };
      await montar();
      await abrirEConfirmar(fluxo);
      expect(dialogo()).toBeNull();
      expect(hospedeiro.textContent).toContain("Você já tem um pedido igual");

      // A cliente abre a pergunta do OUTRO tipo: ela nasce limpa.
      act(() => botao(outro.abrir)?.click());
      expect(dialogo()).not.toBeNull();
      expect(dialogo()?.textContent).not.toContain(
        "Você já tem um pedido igual",
      );
      expect(dialogo()?.querySelectorAll('[role="alert"]')).toHaveLength(0);
    });

    it("enquanto o pedido é gravado: 'Voltar' e a confirmação ficam desabilitados e o texto vira 'Enviando…'", async () => {
      let soltar!: (r: Resposta) => void;
      banco.proximas.push(
        () =>
          new Promise<Resposta>((resolve) => {
            soltar = resolve;
          }),
      );
      await montar();
      act(() => botao(fluxo.abrir)?.click());
      if (fluxo.tipo === "corrigir_email") {
        digitar(campoDoEmail(), "novo@exemplo.invalid");
      }
      await act(async () => {
        botao(fluxo.confirmar, dialogo() as HTMLElement)?.click();
      });
      const voltar = botao("Voltar", dialogo() as HTMLElement);
      const enviando = botao("Enviando", dialogo() as HTMLElement);
      expect(voltar?.disabled).toBe(true);
      expect(enviando?.disabled).toBe(true);
      expect(banco.inserts).toHaveLength(1);
      // Clicar de novo na confirmação desabilitada não grava outro pedido.
      await act(async () => {
        enviando?.click();
      });
      expect(banco.inserts).toHaveLength(1);

      await act(async () => {
        soltar({
          data: pedido({
            tipo: fluxo.tipo,
            email_novo:
              fluxo.tipo === "corrigir_email" ? "novo@exemplo.invalid" : null,
          }),
          error: null,
        });
      });
      await assentar();
      expect(dialogo()).toBeNull();
    });
  });

  describe("pergunta do e-mail", () => {
    it("o motivo da recusa some ao digitar e não volta ao reabrir; o campo reabre vazio", async () => {
      await montar();
      act(() => botao("Corrigir meu e-mail")?.click());
      act(() => botao("Enviar pedido", dialogo() as HTMLElement)?.click());
      expect(corpo()).toContain("Digite o e-mail novo.");
      expect(campoDoEmail().getAttribute("aria-invalid")).toBe("true");
      expect(campoDoEmail().getAttribute("aria-describedby")).toBe(
        "privacidade-email-erro",
      );
      expect(
        document.getElementById("privacidade-email-erro")?.getAttribute("role"),
      ).toBe("alert");

      // Digitar tira o aviso na hora (sem esperar enviar de novo).
      digitar(campoDoEmail(), "a");
      expect(corpo()).not.toContain("Digite o e-mail novo.");
      expect(campoDoEmail().getAttribute("aria-invalid")).toBe("false");
      expect(campoDoEmail().getAttribute("aria-describedby")).toBe(
        "privacidade-email-dica",
      );

      // Errou de novo, fechou, reabriu: sem aviso e sem o texto antigo.
      act(() => botao("Enviar pedido", dialogo() as HTMLElement)?.click());
      expect(corpo()).toContain("Esse e-mail não parece certo.");
      act(() => botao("Voltar", dialogo() as HTMLElement)?.click());
      await assentar();
      act(() => botao("Corrigir meu e-mail")?.click());
      expect(corpo()).not.toContain("Esse e-mail não parece certo.");
      expect(campoDoEmail().value).toBe("");
      expect(campoDoEmail().getAttribute("aria-invalid")).toBe("false");
    });

    it("e-mail recusado devolve o foco ao campo, e nada é gravado", async () => {
      await montar();
      act(() => botao("Corrigir meu e-mail")?.click());
      digitar(campoDoEmail(), "semarroba");
      act(() => botao("Enviar pedido", dialogo() as HTMLElement)?.click());
      expect(document.activeElement).toBe(campoDoEmail());
      expect(banco.inserts).toHaveLength(0);
    });

    it("depois de um aviso de e-mail inválido, um e-mail válido envia e o aviso antigo não fica", async () => {
      banco.padrao = {
        data: pedido({
          id: "ped-e",
          tipo: "corrigir_email",
          email_novo: "certo@exemplo.invalid",
        }),
        error: null,
      };
      await montar();
      act(() => botao("Corrigir meu e-mail")?.click());
      digitar(campoDoEmail(), "errado");
      act(() => botao("Enviar pedido", dialogo() as HTMLElement)?.click());
      expect(corpo()).toContain("Esse e-mail não parece certo.");
      digitar(campoDoEmail(), "certo@exemplo.invalid");
      await act(async () => {
        botao("Enviar pedido", dialogo() as HTMLElement)?.click();
      });
      await assentar();
      expect(banco.inserts).toEqual([
        {
          user_id: USER_ID,
          tipo: "corrigir_email",
          email_novo: "certo@exemplo.invalid",
        },
      ]);
      expect(dialogo()).toBeNull();
      expect(corpo()).not.toContain("Esse e-mail não parece certo.");
    });
  });

  describe("quando dá para pedir de novo", () => {
    it.each(["atendido", "recusado"] as const)(
      "correção de e-mail %s: mostra a decisão e deixa pedir outra correção",
      async (situacao) => {
        banco.lista = {
          data: [
            pedido({
              id: "ped-mail",
              tipo: "corrigir_email",
              email_novo: "trocado@exemplo.invalid",
              situacao,
              atendido_em: "2026-11-04T12:00:00Z",
            }),
          ],
          error: null,
        };
        await montar();
        expect(corpo()).toContain("04/11/2026");
        expect(botao("Corrigir meu e-mail")).toBeDefined();
        // E o outro tipo não é afetado.
        expect(botao("Pedir exclusão da minha conta")).toBeDefined();
      },
    );

    it("pedido de e-mail aberto esconde só o botão do e-mail; a exclusão continua disponível", async () => {
      banco.lista = {
        data: [
          pedido({
            id: "ped-mail",
            tipo: "corrigir_email",
            email_novo: "trocado@exemplo.invalid",
          }),
        ],
        error: null,
      };
      await montar();
      expect(botao("Corrigir meu e-mail")).toBeUndefined();
      expect(botao("Pedir exclusão da minha conta")).toBeDefined();
    });

    it("pedido de exclusão aberto esconde só o botão da exclusão; o e-mail continua disponível", async () => {
      banco.lista = { data: [pedido()], error: null };
      await montar();
      expect(botao("Pedir exclusão da minha conta")).toBeUndefined();
      expect(botao("Corrigir meu e-mail")).toBeDefined();
    });

    it("exclusão recusada com o pedido novo aberto: vale o MAIS RECENTE (esconde o botão)", async () => {
      banco.lista = {
        data: [
          pedido({
            id: "novo",
            criado_em: "2026-11-10T12:00:00Z",
          }),
          pedido({
            id: "velho",
            situacao: "recusado",
            criado_em: "2026-10-01T12:00:00Z",
            atendido_em: "2026-10-03T12:00:00Z",
          }),
        ],
        error: null,
      };
      await montar();
      expect(botao("Pedir exclusão da minha conta")).toBeUndefined();
      expect(corpo()).toContain("Pedido enviado em 10/11/2026");
    });
  });
});
