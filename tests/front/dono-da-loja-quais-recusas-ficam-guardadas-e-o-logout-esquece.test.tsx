// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), travamento "só o dono da loja troca as
// chaves": o que a leitura de `dono_da_loja` GUARDA para a sessão e o que
// esquece.
//   G1  recusa que não muda sozinha (tabela ausente: PGRST205, 42P01, HTTP 404;
//       leitura negada: 42501) fica guardada: reabrir a tela não consulta de novo;
//   G2  falha que pode passar (rede, 500, 503, prazo do banco 57014, sessão
//       401/403) NUNCA fica guardada: a próxima abertura tenta de novo, para uma
//       oscilação não travar as chaves da lojista pelo resto da sessão;
//   G3  sair da conta apaga o que foi lido: a MESMA pessoa que entra de novo é
//       lida de novo (o cargo pode ter mudado enquanto esteve fora).
// Ids fictícios; nenhuma chamada de rede.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  uid: "dono-ficticio" as string | null,
  from: vi.fn(),
  resposta: undefined as unknown,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (...args: unknown[]) => h.from(...args) },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null }),
}));

import { limparDonoDaLoja, useDonoDaLoja } from "@/hooks/useDonoDaLoja";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let ultimo: ReturnType<typeof useDonoDaLoja> | null = null;
function Sonda() {
  const estado = useDonoDaLoja();
  useEffect(() => {
    ultimo = estado;
  });
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar() {
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<Sonda />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

async function desmontar() {
  await act(async () => raiz.unmount());
}

beforeEach(() => {
  h.uid = "dono-ficticio";
  h.resposta = undefined;
  ultimo = null;
  limparDonoDaLoja();
  h.from.mockReset();
  h.from.mockImplementation(() => ({
    select: () => ({ maybeSingle: () => Promise.resolve(h.resposta) }),
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
});

afterEach(async () => {
  await desmontar();
  hospedeiro.remove();
});

describe("useDonoDaLoja: recusa definitiva fica guardada", () => {
  it.each([
    ["PGRST205", { code: "PGRST205", message: "tabela ausente" }],
    ["42P01", { code: "42P01", message: "relação não existe" }],
    ["42501", { code: "42501", message: "leitura negada" }],
    ["HTTP 404 sem código", { status: 404, message: "Not Found" }],
  ])(
    "G1 %s: reabrir a tela NÃO consulta de novo e segue como falha de leitura",
    async (_n, erro) => {
      h.resposta = { data: null, error: erro };
      await montar();
      await desmontar();
      await montar();
      expect(h.from).toHaveBeenCalledTimes(1);
      expect(ultimo).toMatchObject({
        carregando: false,
        souODono: false,
        leituraFalhou: true,
      });
    },
  );
});

describe("useDonoDaLoja: falha que pode passar nunca fica guardada", () => {
  it.each([
    ["rede", { message: "Failed to fetch" }],
    ["HTTP 500", { status: 500, message: "erro interno" }],
    ["HTTP 503", { status: 503, message: "indisponível" }],
    ["HTTP 401", { status: 401, message: "sessão" }],
    ["HTTP 403", { status: 403, message: "proibido" }],
    ["prazo do banco (57014)", { code: "57014", message: "statement timeout" }],
  ])(
    "G2 %s: a próxima abertura consulta de novo e acha o dono",
    async (_n, erro) => {
      h.resposta = { data: null, error: erro };
      await montar();
      expect(ultimo).toMatchObject({ leituraFalhou: true, souODono: false });
      await desmontar();

      h.resposta = { data: { user_id: "dono-ficticio" }, error: null };
      await montar();
      expect(h.from).toHaveBeenCalledTimes(2);
      expect(ultimo).toMatchObject({
        carregando: false,
        souODono: true,
        leituraFalhou: false,
      });
    },
  );
});

describe("useDonoDaLoja: sair da conta esquece o que foi lido", () => {
  it("G3 a mesma pessoa que sai e entra de novo é lida de novo (o cargo pode ter mudado)", async () => {
    h.resposta = { data: { user_id: "dono-ficticio" }, error: null };
    await montar();
    expect(ultimo).toMatchObject({ souODono: true });
    expect(h.from).toHaveBeenCalledTimes(1);

    // Sai da conta: a tela segue montada, sem usuário.
    h.uid = null;
    await act(async () => {
      raiz.render(<Sonda />);
    });
    expect(ultimo).toMatchObject({ souODono: false, carregando: false });

    // Enquanto esteve fora, o dono foi trocado. A mesma pessoa entra de novo.
    h.resposta = { data: { user_id: "outra-pessoa-ficticia" }, error: null };
    h.uid = "dono-ficticio";
    await desmontar();
    await montar();
    expect(h.from).toHaveBeenCalledTimes(2);
    expect(ultimo).toMatchObject({
      carregando: false,
      souODono: false,
      donoId: "outra-pessoa-ficticia",
    });
  });
});
