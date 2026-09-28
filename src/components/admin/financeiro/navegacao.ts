// Estado de navegação DENTRO da tela do Financeiro: qual aba e qual folha
// (bottom sheet / diálogo) está aberta. UMA folha por vez, guardada na view —
// é isso que deixa o Voltar do celular fechar exatamente a folha do topo
// (`onSetBackOverride`) e o aviso de "alterações não salvas" (`onSetDirty`)
// valer para o formulário que está na tela.

import type { FormularioDoLancamento } from "@/lib/financeiro";
import type {
  CaixaAtual,
  CategoriaFinanceira,
  ContaFinanceira,
  DataIso,
  LinhaDoExtrato,
} from "@/types/financeiro";

export type AbaDoFinanceiro =
  | "visao"
  | "extrato"
  | "previstos"
  | "caixa"
  | "dre"
  | "contas";

/** `saida` = a pagar · `entrada` = a receber (vocabulário de `fin_previstos`). */
export type LadoDosPrevistos = "saida" | "entrada";

export interface AlvoDaBaixa {
  readonly id: string;
  readonly descricao: string;
  readonly valor: number;
  readonly contaId: string | null;
  readonly lado: LadoDosPrevistos;
  readonly vencimento: DataIso | null;
}

export interface AlvoDoCancelamento {
  readonly id: string;
  readonly descricao: string;
  readonly valor: number;
}

export type FolhaDoFinanceiro =
  | { readonly tipo: "periodo" }
  | {
      readonly tipo: "novo-lancamento";
      readonly inicial?: Partial<FormularioDoLancamento>;
    }
  | { readonly tipo: "detalhe"; readonly linha: LinhaDoExtrato }
  | { readonly tipo: "baixar"; readonly alvo: AlvoDaBaixa }
  | { readonly tipo: "cancelar"; readonly alvo: AlvoDoCancelamento }
  | { readonly tipo: "caixa-abrir" }
  | {
      readonly tipo: "caixa-movimentar";
      readonly movimento: "sangria" | "suprimento";
      readonly esperado: number;
      readonly contaDoCaixa: string;
    }
  | { readonly tipo: "caixa-fechar"; readonly caixa: CaixaAtual }
  | { readonly tipo: "conta"; readonly conta: ContaFinanceira | null }
  | {
      readonly tipo: "categoria";
      readonly categoria: CategoriaFinanceira | null;
    };

export type AbrirFolha = (folha: FolhaDoFinanceiro) => void;
