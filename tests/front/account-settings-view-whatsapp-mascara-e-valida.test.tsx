// @vitest-environment jsdom
//
// CONTA-06 — o WhatsApp da conta aceita qualquer coisa, e o arquivo que
// corrige isso (`src/utils/telefone.ts`) estava no disco sem nenhum
// importador. `AccountSettingsView.tsx` não tinha máscara nem validação
// nenhuma no campo WhatsApp, apesar de ser o único lugar do app onde esse
// dado é GRAVADO no cadastro (o rastreio de pedido só LÊ, em outro arquivo).
//
// Este teste prende: (1) a máscara progressiva aplicada enquanto a pessoa
// digita, usando `formatarWhatsApp` de `@/utils/telefone`; (2) que salvar
// com menos de 10 dígitos é RECUSADO, com mensagem que diz o que está
// errado, e a RPC de gravação nunca é chamada; (3) que o campo continua
// OPCIONAL — string vazia não deve travar o salvamento, só valor inválido
// não-vazio; (4) que um WhatsApp válido é enviado à RPC já formatado.
//
// Mesmo padrão de account-settings-senha-usa-o-hook-traduzido.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProfile = vi.fn();
const updateProfile = vi.fn();
const updatePassword = vi.fn();
const rpc = vi.fn();

const USUARIO = { id: "cliente-1", email: "cliente@example.com" };
const PERFIL = { avatar_url: null, cover_url: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: PERFIL,
    fetchProfile,
    updateProfile,
    updatePassword,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { updateUser: vi.fn() },
    rpc,
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function localizarBotaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("AccountSettingsView — WhatsApp usa máscara e validação de src/utils/telefone.ts", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "" }],
          error: null,
        });
      }
      return Promise.resolve({ error: null });
    });
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

  async function montarComPerfilCarregado() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await esperarAte(() => {
      const nome = document.getElementById("full_name") as HTMLInputElement;
      return nome.value === "Fulano de Tal";
    });
  }

  it("digitar no campo WhatsApp aplica a máscara progressiva de @/utils/telefone", async () => {
    await montarComPerfilCarregado();

    digitar("phone", "34999998888");

    const telefone = document.getElementById("phone") as HTMLInputElement;
    expect(telefone.value).toBe("(34) 99999-8888");
  });

  it("fixo de 10 dígitos formata como (34) 3333-4444, não (34) 33333-4444", async () => {
    await montarComPerfilCarregado();

    digitar("phone", "3433334444");

    const telefone = document.getElementById("phone") as HTMLInputElement;
    expect(telefone.value).toBe("(34) 3333-4444");
  });

  // CONTA-09 (BLOQUEIA, auditoria de 26/08/2026, camada 5) — o caminho da
  // DIGITAÇÃO não tinha nenhum teste. `formatarWhatsApp` (@/utils/telefone)
  // faz `.slice(0, 11)` sobre TODOS os dígitos digitados/colados — acima de
  // 11 dígitos, os excedentes somem em silêncio e os 11 que sobram são
  // REINTERPRETADOS (o código do país vira DDD), produzindo um número
  // diferente do que a pessoa digitou. Como o resultado tem exatamente 11
  // dígitos, `validarWhatsApp` aprova e nada avisa. Colar
  // "+55 34 99999-8888" (DDD 34, número 99999-8888) virava
  // "(55) 34999-9988" — outro número, com "55" (DDD real de Santa
  // Maria/RS) tornando o defeito invisível numa conferência humana.
  it("CONTA-09: colar número com mais de 11 dígitos NÃO mascara nem trunca — mostra o texto cru", async () => {
    await montarComPerfilCarregado();

    digitar("phone", "+55 34 99999-8888");

    const telefone = document.getElementById("phone") as HTMLInputElement;
    // Nunca "(55) 34999-9988" (o número fabricado pelo truncamento).
    expect(telefone.value).toBe("+55 34 99999-8888");
  });

  it("CONTA-09: salvar depois de colar número com mais de 11 dígitos é recusado — nunca grava o número fabricado", async () => {
    await montarComPerfilCarregado();
    const { toast } = await import("sonner");

    digitar("phone", "+55 34 99999-8888");

    const botaoSalvar = localizarBotaoPorTexto("Salvar Alterações")!;
    await act(async () => {
      botaoSalvar.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(toast.error).toHaveBeenCalledWith(
      "WhatsApp inválido",
      expect.objectContaining({
        description: expect.stringContaining("10 ou 11 dígitos"),
      }),
    );
    const chamadasDeGravacao = rpc.mock.calls.filter(
      (chamada) => chamada[0] === "update_my_profile_secure",
    );
    expect(chamadasDeGravacao).toHaveLength(0);
  });

  // Cenário concreto do achado: WhatsApp legado de 13 dígitos, exibido cru
  // (CONTA-08 já garante isso). A pessoa clica no campo — que existe
  // justamente para sinalizar que aquele número precisa de conserto — e dá
  // UM Backspace, sem digitar mais nada. Antes desta correção, o resultado
  // (12 dígitos) ainda cabia na reinterpretação de `formatarWhatsApp` e
  // virava um número de 11 dígitos "válido", salvo com sucesso.
  it("CONTA-09: um Backspace sobre WhatsApp legado de 13 dígitos não mascara nem permite salvar um número fabricado", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "5534999998888" }],
          error: null,
        });
      }
      return Promise.resolve({ error: null });
    });
    const { toast } = await import("sonner");

    await montarComPerfilCarregado();

    const telefone = document.getElementById("phone") as HTMLInputElement;
    expect(telefone.value).toBe("5534999998888");

    // Simula o resultado de um Backspace: o valor cru menos o último
    // caractere, disparando o mesmo onChange que a digitação real dispara.
    digitar("phone", "553499999888");

    expect(telefone.value).toBe("553499999888");

    const botaoSalvar = localizarBotaoPorTexto("Salvar Alterações")!;
    await act(async () => {
      botaoSalvar.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(toast.error).toHaveBeenCalledWith(
      "WhatsApp inválido",
      expect.objectContaining({
        description: expect.stringContaining("10 ou 11 dígitos"),
      }),
    );
    const chamadasDeGravacao = rpc.mock.calls.filter(
      (chamada) => chamada[0] === "update_my_profile_secure",
    );
    expect(chamadasDeGravacao).toHaveLength(0);
  });

  it("salvar com WhatsApp incompleto (menos de 10 dígitos) é recusado: mensagem clara, RPC de gravação nunca chamada", async () => {
    await montarComPerfilCarregado();
    const { toast } = await import("sonner");

    digitar("phone", "349999988"); // 9 dígitos — nem fixo, nem celular

    const botaoSalvar = localizarBotaoPorTexto("Salvar Alterações")!;
    await act(async () => {
      botaoSalvar.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Específica, não só "foi chamado" — o toast do guarda de carga
    // (`profileLoadState !== "loaded"`, achado de auditoria de 26/08/2026)
    // também chama `toast.error`, e um `toHaveBeenCalled()` sem checar a
    // mensagem passaria de qualquer jeito com o toast errado.
    expect(toast.error).toHaveBeenCalledWith(
      "WhatsApp inválido",
      expect.objectContaining({
        description: expect.stringContaining("10 ou 11 dígitos"),
      }),
    );
    const chamadasDeGravacao = rpc.mock.calls.filter(
      (chamada) => chamada[0] === "update_my_profile_secure",
    );
    expect(chamadasDeGravacao).toHaveLength(0);
  });

  it("WhatsApp vazio continua opcional: salvar sem preencher não é bloqueado pela validação", async () => {
    await montarComPerfilCarregado();

    // Não digita nada no campo WhatsApp — permanece "".
    const botaoSalvar = localizarBotaoPorTexto("Salvar Alterações")!;
    await act(async () => {
      botaoSalvar.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const chamadasDeGravacao = rpc.mock.calls.filter(
      (chamada) => chamada[0] === "update_my_profile_secure",
    );
    expect(chamadasDeGravacao).toHaveLength(1);
  });

  it("WhatsApp válido (11 dígitos) é enviado à RPC já formatado", async () => {
    await montarComPerfilCarregado();

    digitar("phone", "34999998888");

    const botaoSalvar = localizarBotaoPorTexto("Salvar Alterações")!;
    await act(async () => {
      botaoSalvar.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const chamadaDeGravacao = rpc.mock.calls.find(
      (chamada) => chamada[0] === "update_my_profile_secure",
    );
    expect(chamadaDeGravacao).toBeTruthy();
    expect(chamadaDeGravacao![1]).toMatchObject({
      p_whatsapp: "(34) 99999-8888",
    });
  });

  // CONTA-07 (BLOQUEIA, auditoria de 26/08/2026) — cenário concreto: WhatsApp
  // cadastrado com 13 dígitos ("5534999998888", alcançável hoje pelo próprio
  // cadastro, que não limita comprimento). A pessoa abre Conta >
  // Configurações só para corrigir o NOME — nunca toca no campo WhatsApp.
  // Sem esta correção, `formatarWhatsApp` truncava o que aparece na tela
  // para "(55) 34999-9988" (11 dígitos, passa na validação) e esse valor
  // truncado era reenviado como `p_whatsapp`, regravando o telefone real
  // por cima. A correção manda `p_whatsapp: null`, que
  // `update_my_profile_secure` (COALESCE) traduz em "não mexe no que já
  // estava salvo".
  it("CONTA-07: editar só o Nome com WhatsApp legado de 13 dígitos NÃO regrava o telefone truncado", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "5534999998888" }],
          error: null,
        });
      }
      return Promise.resolve({ error: null });
    });

    await montarComPerfilCarregado();

    // A tela mostra o telefone CRU — 13 dígitos não cabem na máscara de
    // 10/11, e mascarar mentiria sobre o que está gravado (CONTA-08,
    // achado de auditoria de 26/08/2026). O valor exibido tem que bater
    // com o que está no banco, não com o que a máscara consegue desenhar.
    const telefone = document.getElementById("phone") as HTMLInputElement;
    expect(telefone.value).toBe("5534999998888");

    // A pessoa mexe SÓ no nome — nunca dispara o onChange do campo WhatsApp.
    digitar("full_name", "Fulano Editado");

    const botaoSalvar = localizarBotaoPorTexto("Salvar Alterações")!;
    await act(async () => {
      botaoSalvar.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const chamadaDeGravacao = rpc.mock.calls.find(
      (chamada) => chamada[0] === "update_my_profile_secure",
    );
    expect(chamadaDeGravacao).toBeTruthy();
    expect(chamadaDeGravacao![1]).toMatchObject({
      p_full_name: "Fulano Editado",
      p_whatsapp: null,
    });
  });

  // CONTA-08 (auditoria de 26/08/2026, junto com CONTA-07) — o contraponto:
  // um WhatsApp legado que CABE na máscara (11 dígitos) continua aparecendo
  // mascarado ao carregar a tela. A correção do CONTA-07 não pode fazer a
  // exibição normal regredir para o valor cru.
  it("CONTA-08: WhatsApp legado de 11 dígitos (cabe na máscara) aparece mascarado ao carregar", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp: "34999998888" }],
          error: null,
        });
      }
      return Promise.resolve({ error: null });
    });

    await montarComPerfilCarregado();

    const telefone = document.getElementById("phone") as HTMLInputElement;
    expect(telefone.value).toBe("(34) 99999-8888");
  });
});
