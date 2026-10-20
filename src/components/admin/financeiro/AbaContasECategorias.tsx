import { ChevronRight, Plus, Tags, Wallet } from "lucide-react";

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
import { IconeDoTipoDeConta, matizDoTipoDeConta } from "./icones";
import type { AbrirFolha } from "./navegacao";
import {
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_CASCA_DA_LINHA_BOTAO,
  CLASSE_SETA_DA_LINHA_BOTAO,
  CLASSE_TITULO_SECAO,
  CartaoSecao,
  Dinheiro,
  EsqueletoDeLista,
  EstadoDeErro,
  EstadoVazio,
  Etiqueta,
  SeloFinanceiro,
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
      className={cn(
        CLASSE_BOTAO_SECUNDARIO,
        "min-h-11 w-full px-3 text-sm text-blue-300",
      )}
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
    <ul className="flex flex-col gap-7">
      {contas.map((conta) => {
        return (
          <li key={conta.id}>
            <button
              type="button"
              onClick={() => abrirFolha({ tipo: "conta", conta })}
              className={`${CLASSE_CASCA_DA_LINHA_BOTAO} relative flex min-h-14 w-full flex-wrap items-start gap-3 p-4`}
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl border"
                style={{
                  color: matizDoTipoDeConta(conta.tipo),
                  backgroundColor: `${matizDoTipoDeConta(conta.tipo)}1A`,
                  borderColor: `${matizDoTipoDeConta(conta.tipo)}40`,
                }}
              >
                <IconeDoTipoDeConta tipo={conta.tipo} className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 pr-5">
                  <span className="break-words text-[15px] font-bold leading-tight text-white">
                    {conta.nome}
                  </span>
                  {conta.sistema ? <Etiqueta>Sistema</Etiqueta> : null}
                  {conta.ativa ? null : <Etiqueta>Inativa</Etiqueta>}
                </span>
                <span className="mt-1 block text-xs text-zinc-400">
                  {rotuloDoTipoDeConta(conta.tipo)}
                </span>
              </span>
              <span className="block w-full break-words text-xs leading-relaxed text-zinc-400">
                Saldo inicial <Dinheiro valor={conta.saldoInicial} /> em{" "}
                {formatarData(conta.saldoInicialEm)}
              </span>
              <span className="flex w-full flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs text-zinc-400">Saldo atual</span>
                <Dinheiro
                  valor={conta.saldo}
                  className={cn(
                    "text-2xl font-bold",
                    conta.saldo < 0 ? "text-red-300" : "text-white",
                  )}
                />
                <ChevronRight
                  aria-hidden="true"
                  className={`${CLASSE_SETA_DA_LINHA_BOTAO} absolute right-4 top-5`}
                />
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
        <p className="px-1 text-xs text-zinc-400">Nenhuma ainda.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {daNatureza.map((categoria) => (
            <li key={categoria.id}>
              <button
                type="button"
                onClick={() => abrirFolha({ tipo: "categoria", categoria })}
                className={`${CLASSE_CASCA_DA_LINHA_BOTAO} flex min-h-14 w-full items-center gap-3 px-3.5 py-3`}
              >
                <SeloFinanceiro
                  icone={Tags}
                  matiz={
                    !categoria.ativa
                      ? "#ABABB7"
                      : natureza === "receita"
                        ? "#2DD4BF"
                        : "#FF9F5A"
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[15px] font-bold leading-tight text-white">
                    {categoria.nome}
                  </span>
                  <span className="mt-1 block break-words text-xs leading-relaxed text-zinc-400">
                    {rotuloDoGrupoDre(categoria.grupoDre)}
                    {categoria.sistema ? " · Sistema" : ""}
                    {categoria.ativa ? "" : " · Inativa"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <ChevronRight
                    aria-hidden="true"
                    className={CLASSE_SETA_DA_LINHA_BOTAO}
                  />
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
    <div className="grid grid-cols-1 gap-7 lg:grid-cols-2">
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
        subtitulo="Cada categoria cai numa linha do resultado"
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
