import { Pencil, Plus, Tags, Wallet } from "lucide-react";

import type { ConsultaFinanceira } from "@/hooks/useFinanceiro";
import {
  formatarData,
  rotuloDoGrupoDre,
  rotuloDoTipoDeConta,
} from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type {
  CategoriaFinanceira,
  ContaFinanceira,
  NaturezaDaCategoria,
} from "@/types/financeiro";
import { IconeDoTipoDeConta } from "./icones";
import type { AbrirFolha } from "./navegacao";
import {
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_TITULO_SECAO,
  CartaoSecao,
  Dinheiro,
  EsqueletoDeLista,
  EstadoDeErro,
  EstadoVazio,
  Etiqueta,
} from "./partes";

function BotaoNovo({
  rotulo,
  aoClicar,
}: {
  readonly rotulo: string;
  readonly aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className={cn(CLASSE_BOTAO_SECUNDARIO, "min-h-11 px-3 text-xs")}
    >
      <Plus aria-hidden="true" className="size-4" />
      {rotulo}
    </button>
  );
}

function ListaDeContas({
  contas,
  abrirFolha,
}: {
  readonly contas: readonly ContaFinanceira[];
  readonly abrirFolha: AbrirFolha;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {contas.map((conta) => {
        return (
          <li key={conta.id}>
            <button
              type="button"
              onClick={() => abrirFolha({ tipo: "conta", conta })}
              className={cn(
                "flex min-h-14 w-full items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-left transition-colors hover:bg-white/5",
                !conta.ativa && "opacity-60",
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300">
                <IconeDoTipoDeConta tipo={conta.tipo} className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold text-white">
                    {conta.nome}
                  </span>
                  {conta.sistema ? (
                    <Etiqueta tom="ouro">Sistema</Etiqueta>
                  ) : null}
                  {conta.ativa ? null : <Etiqueta>Inativa</Etiqueta>}
                </span>
                <span className="block truncate text-[11px] text-zinc-500">
                  {rotuloDoTipoDeConta(conta.tipo)} · saldo inicial{" "}
                  <Dinheiro valor={conta.saldoInicial} /> em{" "}
                  {formatarData(conta.saldoInicialEm)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Dinheiro
                  valor={conta.saldo}
                  className={cn(
                    "text-sm font-black",
                    conta.saldo < 0 ? "text-red-300" : "text-white",
                  )}
                />
                <Pencil aria-hidden="true" className="size-4 text-zinc-600" />
                <span className="sr-only">Editar</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ListaDeCategorias({
  categorias,
  natureza,
  abrirFolha,
}: {
  readonly categorias: readonly CategoriaFinanceira[];
  readonly natureza: NaturezaDaCategoria;
  readonly abrirFolha: AbrirFolha;
}) {
  const daNatureza = categorias.filter((c) => c.natureza === natureza);
  return (
    <section aria-label={natureza === "receita" ? "Receitas" : "Despesas"}>
      <h3 className={cn(CLASSE_TITULO_SECAO, "mb-2 px-1")}>
        {natureza === "receita" ? "Receitas" : "Despesas"} · {daNatureza.length}
      </h3>
      {daNatureza.length === 0 ? (
        <p className="px-1 text-xs text-zinc-500">Nenhuma ainda.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {daNatureza.map((categoria) => (
            <li key={categoria.id}>
              <button
                type="button"
                onClick={() => abrirFolha({ tipo: "categoria", categoria })}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-left transition-colors hover:bg-white/5",
                  !categoria.ativa && "opacity-60",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-bold text-white">
                    {categoria.nome}
                  </span>
                  {categoria.sistema ? (
                    <Etiqueta tom="ouro">Sistema</Etiqueta>
                  ) : null}
                  {categoria.ativa ? null : <Etiqueta>Inativa</Etiqueta>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Etiqueta>{rotuloDoGrupoDre(categoria.grupoDre)}</Etiqueta>
                  <Pencil aria-hidden="true" className="size-4 text-zinc-600" />
                  <span className="sr-only">Editar</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Aba "Contas e categorias": onde o dinheiro mora e em que linha da DRE
 * cada valor cai. As contas e categorias de sistema aparecem marcadas — o
 * app depende delas (as vendas caem sozinhas nas contas de sistema).
 */
export function AbaContasECategorias({
  contas,
  categorias,
  abrirFolha,
}: {
  readonly contas: ConsultaFinanceira<ContaFinanceira[]>;
  readonly categorias: ConsultaFinanceira<CategoriaFinanceira[]>;
  readonly abrirFolha: AbrirFolha;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
      <CartaoSecao
        titulo="Contas"
        subtitulo="Gaveta, banco, Mercado Pago — o saldo de cada uma"
        acao={
          <BotaoNovo
            rotulo="Nova conta"
            aoClicar={() => abrirFolha({ tipo: "conta", conta: null })}
          />
        }
      >
        {contas.erro && !contas.dados ? (
          <EstadoDeErro
            mensagem={contas.erro}
            aoTentarDeNovo={contas.recarregar}
          />
        ) : !contas.dados ? (
          <EsqueletoDeLista linhas={3} />
        ) : contas.dados.length === 0 ? (
          <EstadoVazio
            icone={Wallet}
            titulo="Nenhuma conta"
            texto="Cadastre onde o dinheiro da loja mora."
            acao={
              <BotaoNovo
                rotulo="Nova conta"
                aoClicar={() => abrirFolha({ tipo: "conta", conta: null })}
              />
            }
          />
        ) : (
          <ListaDeContas contas={contas.dados} abrirFolha={abrirFolha} />
        )}
      </CartaoSecao>

      <CartaoSecao
        titulo="Categorias"
        subtitulo="Cada categoria cai numa linha da DRE"
        acao={
          <BotaoNovo
            rotulo="Nova categoria"
            aoClicar={() => abrirFolha({ tipo: "categoria", categoria: null })}
          />
        }
      >
        {categorias.erro && !categorias.dados ? (
          <EstadoDeErro
            mensagem={categorias.erro}
            aoTentarDeNovo={categorias.recarregar}
          />
        ) : !categorias.dados ? (
          <EsqueletoDeLista linhas={5} />
        ) : categorias.dados.length === 0 ? (
          <EstadoVazio
            icone={Tags}
            titulo="Nenhuma categoria"
            texto="Crie categorias para separar aluguel, fornecedor, taxas…"
            acao={
              <BotaoNovo
                rotulo="Nova categoria"
                aoClicar={() =>
                  abrirFolha({ tipo: "categoria", categoria: null })
                }
              />
            }
          />
        ) : (
          <div className="flex flex-col gap-5">
            <ListaDeCategorias
              categorias={categorias.dados}
              natureza="despesa"
              abrirFolha={abrirFolha}
            />
            <ListaDeCategorias
              categorias={categorias.dados}
              natureza="receita"
              abrirFolha={abrirFolha}
            />
          </div>
        )}
      </CartaoSecao>
    </div>
  );
}
