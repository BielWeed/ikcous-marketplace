// Tipos do banco escritos à mão para os fornecedores (migration
// 20261450000000_a_loja_guarda_os_fornecedores.sql): a tabela `fornecedores`.
//
// Contrato entre módulos: o hook `useFornecedores` e a tela leem e gravam por
// estes tipos de `src/types/database.types.ts`. A prova é de TIPO
// (`expectTypeOf`): ela falha no `tsc -b` (que cobre tests/front), não em tempo
// de execução. Se a migration mudar uma coluna (nulidade, default, nome) e o
// tipo não acompanhar, ou o contrário, esta prova deixa de compilar. As
// colunas abaixo são as do CREATE TABLE da migration: só `nome` é obrigatório
// na gravação (id, favorito e as duas datas têm default de servidor).
import { describe, expectTypeOf, it } from "vitest";

import type { Fornecedor } from "@/lib/fornecedores";
import type { Database } from "@/types/database.types";

type Tabela = Database["public"]["Tables"]["fornecedores"];

describe("tipos do banco: fornecedores", () => {
  it("Row: as 11 colunas da migration, com a nulidade dela", () => {
    expectTypeOf<Tabela["Row"]>().toEqualTypeOf<{
      atualizado_em: string;
      cidade: string | null;
      criado_em: string;
      favorito: boolean;
      id: string;
      instagram: string | null;
      nome: string;
      observacoes: string | null;
      site: string | null;
      uf: string | null;
      whatsapp: string | null;
    }>();
  });

  it("Insert: só o nome é obrigatório (id, favorito e datas têm default de servidor)", () => {
    expectTypeOf<Tabela["Insert"]>().toEqualTypeOf<{
      atualizado_em?: string;
      cidade?: string | null;
      criado_em?: string;
      favorito?: boolean;
      id?: string;
      instagram?: string | null;
      nome: string;
      observacoes?: string | null;
      site?: string | null;
      uf?: string | null;
      whatsapp?: string | null;
    }>();
  });

  it("Update: tudo opcional", () => {
    expectTypeOf<Tabela["Update"]>().toEqualTypeOf<{
      atualizado_em?: string;
      cidade?: string | null;
      criado_em?: string;
      favorito?: boolean;
      id?: string;
      instagram?: string | null;
      nome?: string;
      observacoes?: string | null;
      site?: string | null;
      uf?: string | null;
      whatsapp?: string | null;
    }>();
  });

  it("sem chave estrangeira de propósito (não reaproveita produtos.fornecedor_id)", () => {
    expectTypeOf<Tabela["Relationships"]>().toEqualTypeOf<[]>();
  });

  it("o Fornecedor do app é a Row do banco sem as duas datas (a tela não as lê), só de leitura", () => {
    expectTypeOf<Fornecedor>().toEqualTypeOf<
      Readonly<Omit<Tabela["Row"], "criado_em" | "atualizado_em">>
    >();
  });
});
