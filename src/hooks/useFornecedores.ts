// Central de Fornecedores, E1: leitura e escrita dos fornecedores da loja.
//
// Fala direto com a tabela `fornecedores` (PostgREST) pelo cliente Supabase do
// app; quem barra de verdade é o banco (RLS: só o admin de agora lê e escreve;
// ninguém mais, nem o cliente logado). Este hook não decide permissão, só
// traduz a recusa em frase de gente.
//
// O QUE ELE GARANTE (o limite que dói):
//  - CRIAR é por `upsert` no `id` que a TELA gerou antes de abrir a folha: tocar
//    duas vezes, ou repetir depois de uma resposta que se perdeu, regrava a mesma
//    linha e nunca cria outra. Por isso repetir é seguro e a frase pode dizer
//    "tente de novo" sem medo de duplicar.
//  - EDITAR e FAVORITAR pedem a linha de volta (`select`): o PostgREST responde 200
//    com ZERO linhas quando a linha sumiu (outro aparelho excluiu) ou quando a
//    política esconde. Zero linhas NUNCA vira "salvo": vira erro.
//  - EXCLUIR com zero linhas NÃO diz "excluído": ler e apagar usam a mesma regra
//    no banco (RLS), então reler a linha não distinguiria "outro aparelho já
//    excluiu" de "a política escondeu". Vira aviso de lista mudada + recarga.
//  - Cada fornecedor tem uma gravação por vez, e a trava é por AÇÃO + id: o segundo
//    toque na MESMA ação enquanto a primeira não voltou é ignorado (devolve a
//    promessa dela); uma ação DIFERENTE no mesmo id espera a anterior terminar e
//    roda a sua, com a sua resposta (nunca devolve a da outra).
//  - Resposta de leitura velha não sobrescreve a nova (contador de geração).
//  - Nada de dado de fornecedor no console.
//
// SUPOSIÇÃO DECLARADA: a lista lê no máximo 1000 fornecedores (um `range`, sem
// paginação). Uma loja com mais que isso não existe hoje; se existir, vira tarefa
// própria.

import {
  type DadosDoFornecedor,
  type Fornecedor,
  ordenarFornecedores,
} from "@/lib/fornecedores";
import {
  MENSAGEM_CONEXAO_LENTA,
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  aguardarComPrazo,
  ehConsultaSemResposta,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useRef, useState } from "react";

const COLUNAS =
  "id, nome, whatsapp, instagram, site, cidade, uf, observacoes, favorito";
const LIMITE_DA_LISTA = 1000;
const PRAZO_DE_GRAVAR_MS = 20_000;

const FRASE_SO_ADMIN =
  "Só o administrador da loja mexe nos fornecedores. Entre de novo com a conta de administrador.";
const FRASE_NAO_INSTALADO =
  "Os fornecedores ainda não foram instalados no banco desta loja. Fale com o suporte.";
const FRASE_CAMPO_RECUSADO =
  "O banco recusou algum campo. Confira os dados e tente de novo.";
const FRASE_SEM_SERVIDOR =
  "Não consegui falar com o servidor. Confira a internet e tente de novo.";
const FRASE_NAO_EXISTE_MAIS =
  "Este fornecedor não existe mais (talvez tenha sido excluído em outro aparelho). Atualize a lista.";
const FRASE_LISTA_MUDOU =
  "A lista mudou e este fornecedor não foi excluído por aqui. Atualizei a lista: confira se ele ainda aparece.";
const FRASE_GENERICA = "Não deu certo agora. Tente de novo em instantes.";

/** Erro já em português, pronto para a tela. */
export class ErroDosFornecedores extends Error {
  /**
   * A gravação estourou o prazo sem resposta: o banco PODE ter gravado. A tela não diz
   * "não foi salvo" e relê a lista ao fechar (senão a lojista cadastra de novo e duplica).
   */
  readonly semResposta: boolean;
  constructor(mensagem: string, semResposta = false) {
    super(mensagem);
    this.name = "ErroDosFornecedores";
    this.semResposta = semResposta;
  }
}

function codigoDe(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null) return null;
  const { code } = erro as { code?: unknown };
  return typeof code === "string" && code !== "" ? code : null;
}

/** Traduz a falha do banco/rede numa frase. Nunca devolve o texto cru do servidor. */
export function mensagemDeErroDosFornecedores(erro: unknown): string {
  if (erro instanceof ErroDosFornecedores) return erro.message;
  if (ehConsultaSemResposta(erro)) return MENSAGEM_CONEXAO_LENTA;
  const codigo = codigoDe(erro);
  if (codigo === "42501" || codigo === "PGRST301") return FRASE_SO_ADMIN;
  if (codigo === "PGRST205" || codigo === "42P01") return FRASE_NAO_INSTALADO;
  if (
    codigo === "23514" ||
    codigo === "23502" ||
    codigo === "22P02" ||
    codigo === "22001"
  ) {
    return FRASE_CAMPO_RECUSADO;
  }
  if (codigo === null) return FRASE_SEM_SERVIDOR;
  return FRASE_GENERICA;
}

function falha(erro: unknown): ErroDosFornecedores {
  return erro instanceof ErroDosFornecedores
    ? erro
    : new ErroDosFornecedores(
        mensagemDeErroDosFornecedores(erro),
        ehConsultaSemResposta(erro),
      );
}

function comoFornecedor(linha: unknown): Fornecedor | null {
  if (typeof linha !== "object" || linha === null) return null;
  const l = linha as Record<string, unknown>;
  if (typeof l.id !== "string" || typeof l.nome !== "string") return null;
  const texto = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: l.id,
    nome: l.nome,
    whatsapp: texto(l.whatsapp),
    instagram: texto(l.instagram),
    site: texto(l.site),
    cidade: texto(l.cidade),
    uf: texto(l.uf),
    observacoes: texto(l.observacoes),
    favorito: l.favorito === true,
  };
}

function lista(dados: unknown): Fornecedor[] {
  return Array.isArray(dados)
    ? dados.map(comoFornecedor).filter((f): f is Fornecedor => f !== null)
    : [];
}

function gravando<T>(requisicao: PromiseLike<T>): Promise<T> {
  return aguardarComPrazo(Promise.resolve(requisicao), PRAZO_DE_GRAVAR_MS, () =>
    erroDeConsultaSemResposta(),
  );
}

export interface UseFornecedores {
  /** `null` até a primeira leitura chegar (ou enquanto ela falha). */
  readonly fornecedores: Fornecedor[] | null;
  readonly carregando: boolean;
  /** Frase pronta da última leitura que falhou. */
  readonly erro: string | null;
  readonly recarregar: () => void;
  readonly criar: (id: string, dados: DadosDoFornecedor) => Promise<Fornecedor>;
  /**
   * Aceita só os campos que mudaram: o que NÃO vai no objeto não é tocado no banco
   * (a tela manda só os campos que a lojista mexeu na folha, estrela inclusive).
   */
  readonly editar: (
    id: string,
    dados: Partial<DadosDoFornecedor>,
  ) => Promise<Fornecedor>;
  readonly favoritar: (id: string, favorito: boolean) => Promise<Fornecedor>;
  readonly excluir: (id: string) => Promise<void>;
}

export function useFornecedores(ativo: boolean): UseFornecedores {
  const [fornecedores, setFornecedores] = useState<Fornecedor[] | null>(null);
  const [carregando, setCarregando] = useState(ativo);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const geracao = useRef(0);
  // Por "acao:id": a gravação que ainda está a caminho (a mesma ação não repete).
  const emVoo = useRef(new Map<string, Promise<unknown>>());
  // Por id: o fim da última gravação enfileirada (ação diferente espera por ele).
  const fila = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    if (!ativo) return;
    // A mesma caixa (nao o valor) vai para a limpeza: o contador de geracao e a propria caixa.
    const caixa = geracao;
    const minha = ++caixa.current;
    setCarregando(true);
    aguardarComPrazo(
      Promise.resolve(
        supabase
          .from("fornecedores")
          .select(COLUNAS)
          .order("favorito", { ascending: false })
          .order("nome", { ascending: true })
          .range(0, LIMITE_DA_LISTA - 1),
      ),
      PRAZO_DA_CONSULTA_DO_PAINEL_MS,
      () => erroDeConsultaSemResposta(),
    ).then(
      (resposta) => {
        if (minha !== geracao.current) return;
        if (resposta.error) {
          setErro(mensagemDeErroDosFornecedores(resposta.error));
          setFornecedores(null);
        } else {
          setErro(null);
          setFornecedores(ordenarFornecedores(lista(resposta.data)));
        }
        setCarregando(false);
      },
      (e: unknown) => {
        if (minha !== caixa.current) return;
        setErro(mensagemDeErroDosFornecedores(e));
        setFornecedores(null);
        setCarregando(false);
      },
    );
    return () => {
      // Sair (ou recarregar) invalida a resposta que ainda está a caminho.
      caixa.current++;
    };
  }, [ativo, tentativa]);

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);

  const aplicar = useCallback((nova: Fornecedor) => {
    setFornecedores((atual) =>
      ordenarFornecedores([
        ...(atual ?? []).filter((f) => f.id !== nova.id),
        nova,
      ]),
    );
  }, []);

  /**
   * Uma gravação por fornecedor por vez, e a chave é AÇÃO + id:
   *  - a MESMA ação ainda a caminho (toque duplo na estrela ou no Salvar) devolve a
   *    promessa dela, sem segunda chamada;
   *  - uma ação DIFERENTE no mesmo id ESPERA a anterior terminar (dando certo ou não) e
   *    só então roda a sua, com a sua própria resposta. Nunca devolve o resultado da
   *    outra (seria "salvo" sem ter ido) e nunca roda em paralelo (embaralharia);
   *  - outro id nunca espera.
   */
  const umaPorVez = useCallback(
    <T>(acao: string, id: string, executar: () => Promise<T>): Promise<T> => {
      const chave = `${acao}:${id}`;
      const existente = emVoo.current.get(chave);
      if (existente) return existente as Promise<T>;
      const anterior = fila.current.get(id) ?? Promise.resolve();
      const p = anterior.then(executar);
      const minhaVez = p.then(
        () => undefined,
        () => undefined,
      );
      emVoo.current.set(chave, p);
      fila.current.set(id, minhaVez);
      const liberar = () => {
        if (emVoo.current.get(chave) === p) emVoo.current.delete(chave);
        if (fila.current.get(id) === minhaVez) fila.current.delete(id);
      };
      minhaVez.then(liberar);
      return p;
    },
    [],
  );

  const criar = useCallback(
    (id: string, dados: DadosDoFornecedor) =>
      umaPorVez("criar", id, async () => {
        try {
          const { data, error } = await gravando(
            supabase
              .from("fornecedores")
              .upsert({ id, ...dados }, { onConflict: "id" })
              .select(COLUNAS)
              .single(),
          );
          if (error) throw error;
          const novo = comoFornecedor(data);
          if (!novo) throw new ErroDosFornecedores(FRASE_GENERICA);
          aplicar(novo);
          return novo;
        } catch (e) {
          throw falha(e);
        }
      }),
    [aplicar, umaPorVez],
  );

  const atualizar = useCallback(
    (
      acao: "editar" | "favoritar",
      id: string,
      mudanca: Partial<DadosDoFornecedor>,
    ) =>
      umaPorVez(acao, id, async () => {
        try {
          const { data, error } = await gravando(
            supabase
              .from("fornecedores")
              .update(mudanca)
              .eq("id", id)
              .select(COLUNAS),
          );
          if (error) throw error;
          const nova = lista(data)[0];
          // 200 com zero linhas: a linha sumiu (ou a política a esconde). Nunca "salvo".
          if (!nova) throw new ErroDosFornecedores(FRASE_NAO_EXISTE_MAIS);
          aplicar(nova);
          return nova;
        } catch (e) {
          throw falha(e);
        }
      }),
    [aplicar, umaPorVez],
  );

  const editar = useCallback(
    (id: string, dados: Partial<DadosDoFornecedor>) =>
      atualizar("editar", id, dados),
    [atualizar],
  );
  const favoritar = useCallback(
    (id: string, favorito: boolean) => atualizar("favoritar", id, { favorito }),
    [atualizar],
  );

  const excluir = useCallback(
    (id: string) =>
      umaPorVez("excluir", id, async () => {
        try {
          const apagada = await gravando(
            supabase.from("fornecedores").delete().eq("id", id).select("id"),
          );
          if (apagada.error) throw apagada.error;
          if (!Array.isArray(apagada.data) || apagada.data.length === 0) {
            // Zero linhas: outro aparelho já excluiu, ou a política escondeu a linha. Ler e
            // apagar usam a MESMA regra no banco, então reler não distingue os dois casos.
            // Não se diz "excluído" (não foi por aqui): a lista é recarregada do servidor.
            setTentativa((t) => t + 1);
            throw new ErroDosFornecedores(FRASE_LISTA_MUDOU);
          }
          setFornecedores((atual) => (atual ?? []).filter((f) => f.id !== id));
        } catch (e) {
          throw falha(e);
        }
      }),
    [umaPorVez],
  );

  return {
    fornecedores,
    carregando,
    erro,
    recarregar,
    criar,
    editar,
    favoritar,
    excluir,
  };
}
