// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), tela "Mercado Pago" de Ajustes: o que
// conta como "digitei e ainda não salvei" (o `dirty` da seção).
//
// Regra do dono: a lojista cola as chaves, SALVA e TESTA. "Testar conexão"
// fala com o Mercado Pago usando o que está SALVO; se houver qualquer coisa
// diferente na tela, o teste enganaria. Por isso, para CADA um dos três campos:
//   - o botão "Testar conexão" fica travado e aparece "Salve para testar";
//   - o pai (a tela de Ajustes) é avisado e passa a bloquear o fecho da
//     seção ("Salve antes de fechar");
//   - voltar ao valor salvo (ou apagar o que digitou) limpa tudo.
// Chaves FALSAS de propósito; nenhuma chamada de rede.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLICA_SALVA = "APP_USR-11111111-1111-4111-8111-111111111111";
const PUBLICA_OUTRA = "APP_USR-22222222-2222-4222-8222-222222222222";

const { invokeFalso } = vi.hoisted(() => ({ invokeFalso: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useDonoDaLoja", () => ({
  useDonoDaLoja: () => ({
    souODono: true,
    carregando: false,
    donoId: "uid-do-dono-ficticio",
    leituraFalhou: false,
  }),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onDirtyMudou = vi.fn<(dirty: boolean) => void>();

const assentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const testar = () => {
  const achado = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Testar conexão"),
  );
  if (!achado) throw new Error("Botão Testar conexão não está na tela.");
  return achado;
};
const textoDaTela = () => document.body.textContent ?? "";
const ultimoAvisoAoPai = () => onDirtyMudou.mock.calls.at(-1)?.[0];

beforeEach(async () => {
  vi.clearAllMocks();
  invokeFalso.mockImplementation(async (_nome: string, { body }: any) => ({
    data:
      body?.acao === "ler"
        ? {
            configurado: true,
            public_key: PUBLICA_SALVA,
            mascara_token: "••••0000",
            mascara_webhook: "••••1111",
            ultimo_teste: {
              quando: "2026-11-24T10:00:00.000Z",
              conectado: true,
              mensagem: "Conectado",
              ambiente: "producao",
              conta: "Loja",
            },
            atualizado_em: "2026-11-24T10:00:00.000Z",
            pix_ligado: true,
            public_key_na_loja: true,
            faltando: [],
            pausado: false,
          }
        : null,
    error: null,
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(
      <MercadoPagoSection abrirChavesGatilho={1} onDirtyMudou={onDirtyMudou} />,
    );
  });
  await assentar();
});

afterEach(async () => {
  await act(async () => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

describe("seção Mercado Pago: o que conta como 'digitei e não salvei'", () => {
  it("D0 recém-aberta, nada digitado: teste liberado, sem aviso, pai sabe que está limpo", () => {
    expect(testar().disabled).toBe(false);
    expect(textoDaTela()).not.toContain("Salve para testar");
    expect(ultimoAvisoAoPai()).toBe(false);
  });

  it.each([
    ["chave pública diferente da salva", "mp-public-key", PUBLICA_OUTRA],
    ["chave secreta digitada", "mp-access-token", "TEST-chave-ficticia-0000"],
    ["senha dos avisos digitada", "mp-webhook-secret", "senha-ficticia-0000"],
  ])(
    "D1 %s: teste travado, aviso na tela e pai avisado",
    async (_n, id, valor) => {
      await act(async () => {
        digitar(id, valor);
      });
      expect(testar().disabled).toBe(true);
      expect(textoDaTela()).toContain("Salve para testar");
      expect(ultimoAvisoAoPai()).toBe(true);
    },
  );

  it.each([
    ["chave pública", "mp-public-key", PUBLICA_OUTRA, PUBLICA_SALVA],
    ["chave secreta", "mp-access-token", "TEST-chave-ficticia-0000", ""],
    ["senha dos avisos", "mp-webhook-secret", "senha-ficticia-0000", ""],
  ])(
    "D2 %s: voltar ao valor salvo (ou apagar) limpa o aviso e destrava o teste",
    async (_n, id, valor, aoVoltar) => {
      await act(async () => {
        digitar(id, valor);
      });
      expect(ultimoAvisoAoPai()).toBe(true);
      await act(async () => {
        digitar(id, aoVoltar);
      });
      expect(testar().disabled).toBe(false);
      expect(textoDaTela()).not.toContain("Salve para testar");
      expect(ultimoAvisoAoPai()).toBe(false);
    },
  );
});
