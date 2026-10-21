import { FolhaDoPainel } from "@/components/admin/primitivos/FolhaDoPainel";
import { useCategories } from "@/hooks/useCategories";
import { useUsoDasCategorias } from "@/hooks/useUsoDasCategorias";
import {
  type CategoriaComUso,
  ErroDeCategoria,
  LIMITE_DO_NOME_DA_CATEGORIA,
  categoriaEmUso,
  descreverUso,
  erroDoNomeReservado,
  fraseDoRenome,
  mensagemDaFalhaDeCategoria,
} from "@/lib/gestao-de-categorias";
import {
  CHAVES_DE_ICONES,
  IconeDaCategoria,
  iconeDaCategoria,
  nomeDoIcone,
} from "@/lib/icones-de-categoria";
import { Eye, EyeOff, Layers, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Gerenciar categorias (migration 20261237000000). A lojista só conseguia CRIAR
// categoria; renomear e apagar não existiam porque a categoria do produto é
// guardada pelo NOME (texto) em quatro lugares, e trocar só a linha deixava o
// produto sumido da vitrine, o banner apontando para página vazia e a regra de
// "sem troca" da devolução apontando para um nome que não existe.
//
// Esta tela NÃO decide nada disso: renomear e apagar são portas do banco
// (`renomear_categoria`, `apagar_categoria_vazia`), que trocam os quatro lugares
// numa transação e recusam o que deixaria órfão. A tela mostra o que o servidor
// contou (`categorias_com_uso`) e só habilita "Apagar" quando a conta é zero; se
// o banco recusar mesmo assim, o motivo dele aparece na própria linha.

// As telas que guardam o NOME da categoria (o filtro lembrado da lista de
// produtos, o campo do formulário aberto) são avisadas por
// `src/lib/avisos-de-categoria.ts`, que o hook de categorias publica depois de
// cada mudança que o banco aceitou: não depende de onde esta folha foi aberta.

interface GerenciarCategoriasProps {
  readonly aberta: boolean;
  readonly onFechar: () => void;
}

const BOTAO =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-xs font-black uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/50 disabled:pointer-events-none disabled:opacity-40";
const BOTAO_NEUTRO = `${BOTAO} border-admin-border bg-admin-surface text-zinc-300 hover:bg-zinc-800 hover:text-white`;
const BOTAO_DOURADO = `${BOTAO} border-admin-gold bg-admin-gold text-black hover:brightness-110`;
const BOTAO_PERIGO = `${BOTAO} border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20`;

export function GerenciarCategorias({
  aberta,
  onFechar,
}: Readonly<GerenciarCategoriasProps>) {
  return (
    <FolhaDoPainel
      aberta={aberta}
      onFechar={onFechar}
      titulo="Gerenciar categorias"
      icone={Layers}
    >
      {/* O conteúdo só existe com a folha aberta: nada é pedido ao servidor antes. */}
      <ConteudoDaGestao />
    </FolhaDoPainel>
  );
}

function ConteudoDaGestao() {
  const { usos, carregando, erro, recarregar } = useUsoDasCategorias();
  const {
    categories = [],
    renameCategory,
    deleteCategory,
    setCategoryActive,
    updateCategory,
  } = useCategories();

  const [editando, setEditando] = useState<{
    readonly id: string;
    readonly valor: string;
  } | null>(null);
  const [apagando, setApagando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [falha, setFalha] = useState<{
    readonly id: string;
    readonly mensagem: string;
  } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Duplo toque: uma ação por vez, mesmo antes de o React repintar o botão.
  const emVooRef = useRef(false);

  // Foco do teclado: o botão que a lojista apertou some quando o campo (ou a
  // confirmação) aparece, e o foco ia junto. Ao abrir, o foco vai para o campo de
  // nome (ou para "Manter", o lado seguro da confirmação); ao fechar, volta para
  // o botão que abriu.
  const campoDoNomeRef = useRef<HTMLInputElement | null>(null);
  const manterRef = useRef<HTMLButtonElement | null>(null);
  const [devolverFoco, setDevolverFoco] = useState<string | null>(null);
  const idEditando = editando?.id ?? null;
  const editorOcupadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (idEditando) campoDoNomeRef.current?.focus();
  }, [idEditando]);
  useEffect(() => {
    // Se a gravação terminou e o mesmo editor ficou aberto, o nome voltou a
    // aceitar correção. Desabilitar o campo durante o envio tirou seu foco.
    if (
      idEditando !== null &&
      editorOcupadoRef.current === idEditando &&
      ocupado !== idEditando
    ) {
      campoDoNomeRef.current?.focus();
    }
    editorOcupadoRef.current = ocupado === idEditando ? idEditando : null;
  }, [idEditando, ocupado]);
  useEffect(() => {
    if (apagando) manterRef.current?.focus();
  }, [apagando]);
  useEffect(() => {
    // Só com a tela livre: durante a ação o botão está desabilitado e não recebe foco.
    if (!devolverFoco || ocupado !== null) return;
    document.getElementById(devolverFoco)?.focus();
    setDevolverFoco(null);
  }, [devolverFoco, ocupado]);

  async function executar(
    id: string,
    acao: () => Promise<string>,
    depois?: () => void,
  ) {
    if (emVooRef.current) return;
    emVooRef.current = true;
    setOcupado(id);
    setFalha(null);
    setAviso(null);
    try {
      const frase = await acao();
      depois?.();
      setAviso(frase);
      toast.success(frase);
      await recarregar();
    } catch (e) {
      setFalha({
        id,
        mensagem:
          e instanceof ErroDeCategoria
            ? e.message
            : mensagemDaFalhaDeCategoria(e),
      });
    } finally {
      emVooRef.current = false;
      setOcupado(null);
    }
  }

  function salvarNome(c: CategoriaComUso, valor: string) {
    void executar(
      c.id,
      async () => {
        const r = await renameCategory(c.id, valor);
        return fraseDoRenome(r);
      },
      () => {
        setEditando(null);
        setDevolverFoco(`renomear-categoria-${c.id}`);
      },
    );
  }

  function apagar(c: CategoriaComUso) {
    void executar(
      c.id,
      async () => {
        const r = await deleteCategory(c.id);
        return `Categoria “${r.nome}” apagada.`;
      },
      () => setApagando(null),
    );
  }

  function alternarVitrine(c: CategoriaComUso) {
    void executar(c.id, async () => {
      await setCategoryActive(c.id, !c.ativa);
      return c.ativa
        ? `“${c.nome}” saiu do filtro da vitrine. Os produtos continuam à venda em “Todas”.`
        : `“${c.nome}” voltou ao filtro da vitrine.`;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        Renomeie, esconda da vitrine ou apague categorias. Ao renomear, os
        produtos, os banners e a regra de devolução dessa categoria acompanham o
        nome novo.
      </p>

      {aviso ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-300"
        >
          {aviso}
        </p>
      ) : null}

      {erro ? (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          <p>{erro}</p>
          <button
            type="button"
            className={BOTAO_NEUTRO}
            onClick={() => void recarregar()}
          >
            Tentar de novo
          </button>
        </div>
      ) : null}

      {carregando && !usos ? (
        <p className="text-sm text-zinc-500">Carregando as categorias…</p>
      ) : null}

      {usos && usos.length === 0 && !erro ? (
        <p className="text-sm text-zinc-500">
          Nenhuma categoria ainda. Crie a primeira ao cadastrar um produto.
        </p>
      ) : null}

      <ul className="space-y-3">
        {(usos ?? []).map((c) => {
          const categoria = categories.find((item) => item.id === c.id) ?? {
            name: c.nome,
            icone: null,
          };
          const uso = descreverUso(c);
          const emUso = categoriaEmUso(c);
          const nestaLinha = ocupado === c.id;
          const esteEdita = editando?.id === c.id;
          const esteApaga = apagando === c.id;
          const valor = editando?.valor ?? "";
          const nomeIgual = esteEdita && valor === c.nome;
          const nomeReservado = esteEdita ? erroDoNomeReservado(valor) : null;
          return (
            <li
              key={c.id}
              className="space-y-3 rounded-2xl border border-admin-border bg-zinc-950/60 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <IconeDaCategoria
                  icone={iconeDaCategoria(categoria)}
                  className="size-6 shrink-0 text-zinc-300"
                />
                <span className="min-w-0 break-words text-base font-black text-white">
                  {c.nome}
                </span>
                {c.ativa ? null : (
                  <span className="rounded-md border border-zinc-600 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-zinc-400">
                    Escondida da vitrine
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                {uso
                  ? `Em uso: ${uso}.`
                  : "Sem nenhum produto, banner ou regra."}
              </p>

              <details>
                <summary className="flex min-h-11 cursor-pointer items-center rounded-lg text-sm font-bold text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400">
                  Escolher ícone
                </summary>
                <fieldset
                  disabled={ocupado !== null}
                  className="grid grid-cols-3 gap-2 pt-2 sm:grid-cols-5"
                >
                  <legend className="sr-only">Ícone de {c.nome}</legend>
                  {[null, ...CHAVES_DE_ICONES].map((chave) => (
                    <button
                      type="button"
                      key={chave ?? "automatico"}
                      aria-label={`Ícone ${chave ? nomeDoIcone(chave) : "Automático"} para ${c.nome}`}
                      aria-pressed={(categoria.icone ?? null) === chave}
                      className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-admin-border bg-admin-surface px-1 py-2 text-xs text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 aria-pressed:border-zinc-400 aria-pressed:bg-zinc-800 disabled:opacity-40"
                      onClick={() =>
                        void executar(c.id, async () => {
                          await updateCategory(c.id, { icone: chave }, true);
                          return `Ícone de “${c.nome}” atualizado.`;
                        })
                      }
                    >
                      <IconeDaCategoria
                        icone={chave ?? iconeDaCategoria({ name: c.nome })}
                        className="size-6"
                      />
                      {chave ? nomeDoIcone(chave) : "Automático"}
                    </button>
                  ))}
                </fieldset>
              </details>

              {esteEdita ? (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!nomeIgual && !nomeReservado && valor.trim() !== "")
                      salvarNome(c, valor);
                  }}
                >
                  <label
                    htmlFor={`nome-da-categoria-${c.id}`}
                    className="block text-[11px] font-black uppercase tracking-widest text-zinc-500"
                  >
                    Novo nome
                  </label>
                  <input
                    id={`nome-da-categoria-${c.id}`}
                    ref={campoDoNomeRef}
                    aria-invalid={nomeReservado ? true : undefined}
                    aria-describedby={
                      nomeReservado ? `nome-reservado-${c.id}` : undefined
                    }
                    type="text"
                    value={valor}
                    disabled={nestaLinha}
                    maxLength={LIMITE_DO_NOME_DA_CATEGORIA}
                    onChange={(e) =>
                      setEditando({ id: c.id, valor: e.target.value })
                    }
                    className="min-h-11 w-full rounded-xl border border-admin-border bg-zinc-950 px-4 text-sm font-bold text-white focus:border-admin-gold focus:outline-none focus:ring-2 focus:ring-admin-gold/30"
                  />
                  {nomeReservado ? (
                    <p
                      id={`nome-reservado-${c.id}`}
                      role="alert"
                      className="text-xs font-bold text-amber-300"
                    >
                      {nomeReservado}
                    </p>
                  ) : null}
                  {uso ? (
                    <p className="text-xs text-zinc-500">
                      Vão acompanhar o nome novo: {uso}.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={
                        nestaLinha ||
                        nomeIgual ||
                        valor.trim() === "" ||
                        nomeReservado !== null
                      }
                      className={BOTAO_DOURADO}
                    >
                      {nestaLinha ? "Salvando…" : "Salvar nome"}
                    </button>
                    <button
                      type="button"
                      disabled={nestaLinha}
                      className={BOTAO_NEUTRO}
                      onClick={() => {
                        setEditando(null);
                        setFalha(null);
                        setDevolverFoco(`renomear-categoria-${c.id}`);
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : null}

              {esteApaga ? (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-red-200">
                    Apagar “{c.nome}”? Não dá para desfazer.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={nestaLinha}
                      className={BOTAO_PERIGO}
                      onClick={() => apagar(c)}
                    >
                      {nestaLinha ? "Apagando…" : "Apagar de vez"}
                    </button>
                    <button
                      type="button"
                      ref={manterRef}
                      disabled={nestaLinha}
                      className={BOTAO_NEUTRO}
                      onClick={() => {
                        setApagando(null);
                        setFalha(null);
                        setDevolverFoco(`apagar-categoria-${c.id}`);
                      }}
                    >
                      Manter
                    </button>
                  </div>
                </div>
              ) : null}

              {falha?.id === c.id ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  {falha.mensagem}
                </p>
              ) : null}

              {esteEdita || esteApaga ? null : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    id={`renomear-categoria-${c.id}`}
                    aria-label={`Renomear ${c.nome}`}
                    disabled={ocupado !== null}
                    className={BOTAO_NEUTRO}
                    onClick={() => {
                      setFalha(null);
                      setAviso(null);
                      setApagando(null);
                      setEditando({ id: c.id, valor: c.nome });
                    }}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                    Renomear
                  </button>
                  <button
                    type="button"
                    aria-label={
                      c.ativa
                        ? `Esconder ${c.nome} da vitrine`
                        : `Mostrar ${c.nome} na vitrine`
                    }
                    disabled={ocupado !== null}
                    className={BOTAO_NEUTRO}
                    onClick={() => alternarVitrine(c)}
                  >
                    {c.ativa ? (
                      <EyeOff aria-hidden="true" className="size-4" />
                    ) : (
                      <Eye aria-hidden="true" className="size-4" />
                    )}
                    {c.ativa ? "Esconder" : "Mostrar"}
                  </button>
                  <button
                    type="button"
                    id={`apagar-categoria-${c.id}`}
                    aria-label={`Apagar ${c.nome}`}
                    disabled={ocupado !== null || emUso}
                    title={
                      emUso
                        ? "Só dá para apagar categoria sem produto, banner nem regra de devolução."
                        : undefined
                    }
                    className={BOTAO_PERIGO}
                    onClick={() => {
                      setFalha(null);
                      setAviso(null);
                      setEditando(null);
                      setApagando(c.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    Apagar
                  </button>
                </div>
              )}
              {emUso && !esteEdita && !esteApaga ? (
                <p className="text-xs text-zinc-600">
                  Para apagar: mude os produtos para outra categoria, troque o
                  link do banner e tire a categoria da regra de devolução. Se só
                  quer tirá-la da loja, use Esconder.
                  {c.produtosExcluidos > 0
                    ? " Produto excluído não aparece na lista de produtos e só sai da categoria com a ajuda do suporte."
                    : ""}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
