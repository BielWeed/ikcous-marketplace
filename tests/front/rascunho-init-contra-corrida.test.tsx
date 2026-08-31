// @vitest-environment jsdom
// A regra react-compiler (react-hooks/incompatible-library) acusa o RHF em
// todo componente deste arquivo — é justamente a biblioteca sob teste (o
// CheckoutView real usa a mesma API). Desligada no arquivo inteiro para não
// inflar o teto de warnings com aviso que não descreve defeito nenhum.
/* eslint-disable react-hooks/incompatible-library */
//
// A CORRIDA DO INIT × WATCH (achado da revisão do PR #374, BLOQUEIA→fix).
//
// O QUE A REVISÃO PROVOU com o react-hook-form do próprio repo: `form.reset`
// emite SINCRONAMENTE para a assinatura do `form.watch` — o callback de
// gravação do rascunho dispara dentro do reset. Se a trava de gravação
// (`hasInitializedRef`) abre ANTES do reset de defaults e a LEITURA do
// rascunho acontece DEPOIS, a sequência grava um rascunho só-de-defaults
// (que contém o CEP de `ikcous_last_shipping_cep`, logo `rascunhoTemConteudo`
// = true) POR CIMA do rascunho cheio — perda silenciosa de nome, endereço,
// notas e cupom exatamente na recarga da página, quando a view monta antes
// da config da loja chegar.
//
// A CURA fixada aqui: LER o rascunho na memória ANTES de qualquer reset e
// antes de abrir a trava; as gravações transitórias dos resets são
// substituídas, logo depois, pela gravação dos valores restaurados.
//
// Este harness reproduz o PAR init×watch do CheckoutView com o react-hook-
// form REAL — os efeitos na MESMA ordem e com as MESMAS travas
// (hasInitializedRef antes de gravar; rascunhoTemConteudo antes de gravar) —
// sem montar a view inteira, o mesmo compromisso dos testes da chave da
// compra (pedido-em-dobro-morre-na-chave).
import { useEffect, useRef } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { useForm } from "react-hook-form";

import {
  lerRascunhoDoCheckout,
  rascunhoTemConteudo,
  salvarRascunhoDoCheckout,
  type RascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";
import type { ArmazenamentoSimples } from "@/lib/chave-do-pedido";

// @ts-expect-error flag interna do React — padrão dos testes de componente.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "ikcous-rascunho-do-checkout-v1";

interface Valores {
  name: string;
  whatsapp: string;
  cep: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  complement: string;
}

function rascunhoDe(valores: Valores, cupom: string | null): RascunhoDoCheckout {
  return {
    nome: valores.name,
    whatsapp: valores.whatsapp,
    cep: valores.cep,
    numero: valores.number,
    rua: valores.street,
    bairro: valores.neighborhood,
    cidade: valores.city,
    estado: valores.state,
    complemento: valores.complement,
    notas: "",
    cupom,
  };
}

const DEFAULTS: Valores = {
  name: "",
  whatsapp: "",
  // O CEP que o localStorage da casa semeia no checkout real.
  cep: "38500-000",
  street: "",
  number: "",
  neighborhood: "",
  city: "",
  state: "",
  complement: "",
};

function Harness({
  storeConfigLoaded,
  storage,
}: {
  storeConfigLoaded: boolean;
  storage: ArmazenamentoSimples;
}) {
  const form = useForm<Valores>({ defaultValues: DEFAULTS, mode: "onChange" });
  const hasInitializedRef = useRef(false);
  const cupomRef = useRef<string | null>(null);

  // EFEITO INIT — ordem idêntica à do CheckoutView pós-correção:
  // ler o rascunho PRIMEIRO, abrir a trava, reset defaults, aplicar rascunho.
  useEffect(() => {
    if (storeConfigLoaded && !hasInitializedRef.current) {
      const rascunho = lerRascunhoDoCheckout(storage);
      hasInitializedRef.current = true;
      form.reset(DEFAULTS);
      if (rascunho && rascunhoTemConteudo(rascunho)) {
        // Espelho do setAppliedCoupon({code}) do CheckoutView — ANTES do
        // reset: a emissão sincrona do watch ja sai com o cupom. (No real,
        // o estado chega um render depois e o efeito [notes, appliedCoupon]
        // regrava — mesmo resultado final.)
        cupomRef.current = rascunho.cupom;
        form.reset({
          name: rascunho.nome,
          whatsapp: rascunho.whatsapp,
          cep: rascunho.cep || DEFAULTS.cep,
          street: rascunho.rua,
          number: rascunho.numero,
          neighborhood: rascunho.bairro,
          city: rascunho.cidade,
          state: rascunho.estado,
          complement: rascunho.complemento,
        });
      }
    }
  }, [storeConfigLoaded, form, storage]);

  // EFEITO DE GRAVAÇÃO — a assinatura do watch com as MESMAS travas.
  useEffect(() => {
    const subscription = form.watch((valores) => {
      if (!hasInitializedRef.current) return;
      const rascunho = rascunhoDe(valores as Valores, cupomRef.current);
      if (!rascunhoTemConteudo(rascunho)) return;
      salvarRascunhoDoCheckout(storage, rascunho);
    });
    return () => subscription.unsubscribe();
  }, [form, storage]);

  return null;
}

describe("o rascunho sobrevive à corrida init×watch (config chega depois)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let storage: ArmazenamentoSimples;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    storage = criarStorage();
  });

  const rascunhoCheio: RascunhoDoCheckout = {
    nome: "Maria da Prova",
    whatsapp: "34999999999",
    cep: "38500-000",
    numero: "123",
    rua: "Rua da Prova",
    bairro: "Centro",
    cidade: "Araxá",
    estado: "MG",
    complemento: "Apto 101",
    notas: "deixar na portaria",
    cupom: "CUPOM10",
  };

  it("F5 com config chegando DEPOIS: o rascunho cheio não é sobrescrito pelo reset de defaults", () => {
    salvarRascunhoDoCheckout(storage, rascunhoCheio);

    // 1ª renderização: view monta ANTES da config (storeConfigLoaded=false)
    // — o init pula, mas a assinatura do watch já fica armada (é assim no
    // CheckoutView: o efeito de gravação roda no mount).
    act(() => {
      root.render(<Harness storeConfigLoaded={false} storage={storage} />);
    });
    // 2ª renderização: a config da loja chega — o init roda AGORA, com o
    // watch já inscrito. É aqui que a versão com trava-antes-da-leitura
    // destruía o rascunho (reset de defaults disparava a gravação).
    act(() => {
      root.render(<Harness storeConfigLoaded={true} storage={storage} />);
    });

    const depois = lerRascunhoDoCheckout(storage);
    expect(depois?.nome).toBe("Maria da Prova");
    expect(depois?.rua).toBe("Rua da Prova");
    expect(depois?.cupom).toBe("CUPOM10");
  });

  it("o mecanismo da corrida é real: reset emite sincronamente para o watch", () => {
    // Controle do mecanismo apontado pela revisão: uma assinatura armada
    // ANTES do reset recebe os valores do reset no mesmo tique. Se isto
    // deixar de ser verdade (RHF mudou), a corrida e a cura precisam de
    // reavaliação — o teste de cima depende deste fato.
    let chamou: unknown = "nunca";
    const Componente = () => {
      const form = useForm<Valores>({
        defaultValues: DEFAULTS,
        mode: "onChange",
      });
      useEffect(() => {
        const sub = form.watch((valores) => {
          chamou = valores;
        });
        act(() => {
          form.reset({ ...form.getValues(), cep: "38500-000" });
        });
        return () => sub.unsubscribe();
      }, [form]);
      return null;
    };
    act(() => {
      root.render(<Componente />);
    });
    expect(chamou).not.toBe("nunca");
    expect((chamou as Valores).cep).toBe("38500-000");
  });

  it("gravação antes do init não cria rascunho falso (trava 1)", () => {
    act(() => {
      root.render(<Harness storeConfigLoaded={false} storage={storage} />);
    });
    // Montou com config pendente: nada de rascunho só-de-CEP gravado por
    // baixo do init — o storage segue como estava (vazio).
    expect(lerRascunhoDoCheckout(storage)).toBeNull();
    expect(storage.getItem(CHAVE)).toBeNull();
  });
});

function criarStorage(): ArmazenamentoSimples {
  const mapa = new Map<string, string>();
  return {
    getItem: (k) => mapa.get(k) ?? null,
    setItem: (k, v) => void mapa.set(k, v),
    removeItem: (k) => void mapa.delete(k),
  };
}
