// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), travamento "só o dono da loja troca as
// chaves": a CORRIDA entre duas leituras de `dono_da_loja`.
//
// A conta A abre o painel e a leitura dela demora; antes de terminar, a conta
// B entra no mesmo aparelho (sem logout). A resposta ATRASADA de A chega
// depois da de B. Duas coisas não podem acontecer:
//   R1  a resposta velha de A não pode mexer no que a tela de B mostra (sem
//       isso a tela de B ficava presa em "carregando" para sempre, e os campos
//       das chaves ficariam travados sem aviso);
//   R2  a resposta velha de A não pode ficar GUARDADA como leitura feita (ela
//       trocaria o cache de B e, na volta de A, a tela usaria uma leitura que
//       nunca foi conferida de novo);
//   R3  desde o PRIMEIRO render de B (com ou sem montagem nova) ela está
//       "carregando": nunca herda, nem por um instante, a leitura de A;
//   R4  a resposta atrasada de A não apaga a leitura em andamento de B: uma
//       segunda tela de B continua dividindo a mesma consulta.
// Os ids abaixo são fictícios.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  uid: "conta-a" as string | null,
  from: vi.fn(),
  respostas: [] as Array<(valor: unknown) => void>,
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
// Cada render que chegou ao DOM: de que conta e o que o gancho respondeu.
let historico: Array<{ uid: string | null; carregando: boolean }> = [];
function Sonda() {
  const estado = useDonoDaLoja();
  useEffect(() => {
    ultimo = estado;
    historico.push({ uid: h.uid, carregando: estado.carregando });
  });
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

const assentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });

async function renderizar() {
  await act(async () => {
    raiz.render(<Sonda />);
  });
  await assentar();
}

function responder(indice: number, resposta: unknown) {
  const responde = h.respostas.at(indice);
  if (!responde) throw new Error(`A leitura ${indice + 1} não foi feita.`);
  return act(async () => {
    responde(resposta);
    await new Promise((r) => setTimeout(r, 5));
  });
}

beforeEach(() => {
  h.uid = "conta-a";
  h.respostas = [];
  ultimo = null;
  historico = [];
  limparDonoDaLoja();
  h.from.mockReset();
  // Cada leitura fica PENDENTE até o teste resolver, na ordem que quiser.
  h.from.mockImplementation(() => ({
    select: () => ({
      maybeSingle: () =>
        new Promise((resolve) => {
          h.respostas.push(resolve);
        }),
    }),
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("useDonoDaLoja: resposta atrasada de OUTRA conta", () => {
  it("R1 a resposta velha de A chega depois da de B e não mexe na tela de B", async () => {
    await renderizar(); // conta A: leitura 1 pendente
    expect(ultimo).toMatchObject({ carregando: true, souODono: false });

    h.uid = "conta-b"; // B entra sem logout: leitura 2 pendente
    await renderizar();
    expect(h.from).toHaveBeenCalledTimes(2);

    // B responde primeiro: há um dono cadastrado e não é B.
    await responder(1, { data: { user_id: "dono-ficticio" }, error: null });
    expect(ultimo).toMatchObject({
      carregando: false,
      souODono: false,
      donoId: "dono-ficticio",
      leituraFalhou: false,
    });

    // A resposta ATRASADA de A (A seria o dono) chega agora.
    await responder(0, { data: { user_id: "conta-a" }, error: null });
    expect(ultimo).toMatchObject({
      carregando: false,
      souODono: false,
      donoId: "dono-ficticio",
      leituraFalhou: false,
    });
  });

  it("R2 a resposta velha de A não fica guardada: ao voltar, A é lida de novo", async () => {
    await renderizar(); // A: leitura 1 pendente
    h.uid = "conta-b";
    await renderizar(); // B: leitura 2 pendente
    await responder(1, { data: { user_id: "dono-ficticio" }, error: null });
    await responder(0, { data: { user_id: "conta-a" }, error: null });

    h.uid = "conta-a"; // A volta
    await renderizar();
    // Nada de cache da resposta velha: nova leitura (a 3ª), que ainda está
    // pendente, então a tela de A espera em vez de afirmar "sou o dono".
    expect(h.from).toHaveBeenCalledTimes(3);
    expect(ultimo).toMatchObject({ carregando: true, souODono: false });

    await responder(2, { data: { user_id: "conta-a" }, error: null });
    expect(ultimo).toMatchObject({
      carregando: false,
      souODono: true,
      donoId: "conta-a",
    });
  });

  it("R3 desde o PRIMEIRO render da conta B ela está 'carregando': nunca herda, nem por um instante, a leitura pronta de A", async () => {
    await renderizar();
    await responder(0, { data: { user_id: "dono-ficticio" }, error: null });
    expect(ultimo).toMatchObject({
      carregando: false,
      donoId: "dono-ficticio",
    });
    const doA = historico.length;

    h.uid = "conta-b";
    await renderizar();

    const deB = historico.slice(doA).filter((r) => r.uid === "conta-b");
    expect(deB.length).toBeGreaterThan(0);
    // O primeiro render de B, antes de qualquer resposta, já é "carregando":
    // se não fosse, os campos das chaves destravariam/travariam com o estado de A.
    expect(deB[0]?.carregando).toBe(true);
  });

  it("R3b abrir a tela de B do zero (montagem nova) com a leitura de A já guardada: o primeiro render de B também é 'carregando'", async () => {
    await renderizar();
    await responder(0, { data: { user_id: "dono-ficticio" }, error: null });
    expect(ultimo).toMatchObject({ carregando: false });
    await act(async () => raiz.unmount());
    const doA = historico.length;

    h.uid = "conta-b";
    raiz = createRoot(hospedeiro);
    await renderizar();

    const deB = historico.slice(doA).filter((r) => r.uid === "conta-b");
    expect(deB[0]?.carregando).toBe(true);
    // E B é lida de verdade (a leitura de A não vale para B).
    expect(h.from).toHaveBeenCalledTimes(2);
  });

  it("R4 a resposta atrasada de A não apaga a leitura em andamento de B: uma segunda tela de B divide a mesma consulta", async () => {
    await renderizar(); // A: leitura 1
    h.uid = "conta-b";
    await renderizar(); // B: leitura 2 (em andamento)
    expect(h.from).toHaveBeenCalledTimes(2);

    await responder(0, { data: { user_id: "conta-a" }, error: null }); // A chega atrasada

    // Outra tela de B abre enquanto a leitura de B ainda está pendente.
    await act(async () => {
      raiz.render(
        <>
          <Sonda />
          <Sonda />
        </>,
      );
    });
    await assentar();
    expect(h.from).toHaveBeenCalledTimes(2);

    await responder(1, { data: { user_id: "dono-ficticio" }, error: null });
    expect(ultimo).toMatchObject({
      carregando: false,
      donoId: "dono-ficticio",
    });
  });

  it("a resposta VELHA de A que chegasse sozinha, depois de B já lida, nunca troca o dono de B", async () => {
    await renderizar();
    h.uid = "conta-b";
    await renderizar();
    await responder(0, { data: { user_id: "conta-a" }, error: null });
    // B ainda lendo: continua "carregando", não herda o dono de A.
    expect(ultimo).toMatchObject({ carregando: true, souODono: false });
    await responder(1, { data: null, error: null });
    // Loja sem dono para B: destravada, e é leitura de verdade.
    expect(ultimo).toMatchObject({
      carregando: false,
      souODono: false,
      donoId: null,
      leituraFalhou: false,
    });
  });
});
