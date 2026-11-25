// Tipos do banco escritos à mão para o cadastro fiscal (migration
// 20261440000000_a_loja_guarda_o_cadastro_fiscal.sql): `fiscal_cadastro`,
// `fiscal_cadastro_log` e a função `fiscal_cadastro_salvar`.
//
// Contrato entre módulos: o front lê estas tabelas e chama esta função pelos
// tipos de `src/types/database.types.ts`. A prova é de TIPO (`expectTypeOf`):
// ela falha no `tsc -b` (que cobre tests/front), não em tempo de execução. Se a
// migration mudar uma coluna (nulidade, default, nome) e o tipo não acompanhar,
// ou o contrário, esta prova deixa de compilar. As colunas abaixo são as do
// CREATE TABLE da migration: `atualizado_em` e `atualizado_por` são NOT NULL,
// `id` do cadastro é boolean, o do log é `bigint GENERATED ALWAYS AS IDENTITY`.
import { describe, expectTypeOf, it } from "vitest";

import type { LinhaDoCadastroFiscal } from "@/lib/fiscal/cadastro";
import type { Database, Json } from "@/types/database.types";

type Tabelas = Database["public"]["Tables"];
type Funcoes = Database["public"]["Functions"];

describe("tipos do banco: fiscal_cadastro (uma linha por loja)", () => {
  it("Row: as 7 colunas da migration, com a nulidade dela", () => {
    expectTypeOf<Tabelas["fiscal_cadastro"]["Row"]>().toEqualTypeOf<{
      aberta_em: string | null;
      atividade: string;
      atualizado_em: string;
      atualizado_por: string;
      id: boolean;
      regime: string;
      vende_no_app_desde: string | null;
    }>();
  });

  it("Insert: só regime, atividade e atualizado_por são obrigatórios", () => {
    expectTypeOf<Tabelas["fiscal_cadastro"]["Insert"]>().toEqualTypeOf<{
      aberta_em?: string | null;
      atividade: string;
      atualizado_em?: string;
      atualizado_por: string;
      id?: boolean;
      regime: string;
      vende_no_app_desde?: string | null;
    }>();
  });

  it("Update: tudo opcional", () => {
    expectTypeOf<Tabelas["fiscal_cadastro"]["Update"]>().toEqualTypeOf<{
      aberta_em?: string | null;
      atividade?: string;
      atualizado_em?: string;
      atualizado_por?: string;
      id?: boolean;
      regime?: string;
      vende_no_app_desde?: string | null;
    }>();
  });

  it("sem chave estrangeira de propósito (a linha sobrevive a quem sai)", () => {
    expectTypeOf<Tabelas["fiscal_cadastro"]["Relationships"]>().toEqualTypeOf<
      []
    >();
  });

  it("LinhaDoCadastroFiscal do app é a Row do banco, não uma cópia", () => {
    expectTypeOf<LinhaDoCadastroFiscal>().toEqualTypeOf<
      Tabelas["fiscal_cadastro"]["Row"]
    >();
  });
});

describe("tipos do banco: fiscal_cadastro_log (a trilha)", () => {
  it("Row: id numérico, antes nulo na primeira vez, depois sempre presente", () => {
    expectTypeOf<Tabelas["fiscal_cadastro_log"]["Row"]>().toEqualTypeOf<{
      antes: Json | null;
      depois: Json;
      id: number;
      quando: string;
      quem: string;
    }>();
  });

  it("Insert: o id é GENERATED ALWAYS (nunca enviado); quem e depois obrigatórios", () => {
    expectTypeOf<Tabelas["fiscal_cadastro_log"]["Insert"]>().toEqualTypeOf<{
      antes?: Json | null;
      depois: Json;
      id?: never;
      quando?: string;
      quem: string;
    }>();
  });

  it("Update: o id continua sendo nunca enviado", () => {
    expectTypeOf<Tabelas["fiscal_cadastro_log"]["Update"]>().toEqualTypeOf<{
      antes?: Json | null;
      depois?: Json;
      id?: never;
      quando?: string;
      quem?: string;
    }>();
  });

  it("sem chave estrangeira de propósito", () => {
    expectTypeOf<
      Tabelas["fiscal_cadastro_log"]["Relationships"]
    >().toEqualTypeOf<[]>();
  });
});

describe("tipos do banco: fiscal_cadastro_salvar (a única porta que grava)", () => {
  it("recebe um objeto jsonb `p` e devolve jsonb", () => {
    expectTypeOf<Funcoes["fiscal_cadastro_salvar"]["Args"]>().toEqualTypeOf<{
      p: Json;
    }>();
    expectTypeOf<
      Funcoes["fiscal_cadastro_salvar"]["Returns"]
    >().toEqualTypeOf<Json>();
  });
});
