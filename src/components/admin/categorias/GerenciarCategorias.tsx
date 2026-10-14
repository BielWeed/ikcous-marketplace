import { FolhaDoPainel } from "@/components/admin/primitivos/FolhaDoPainel";
import { useCategories } from "@/hooks/useCategories";
import { useUsoDasCategorias } from "@/hooks/useUsoDasCategorias";
import {
  type CategoriaComUso,
  ErroDeCategoria,
  LIMITE_DO_NOME_DA_CATEGORIA,
  categoriaEmUso,
  descreverUso,
  fraseDoRenome,
  mensagemDaFalhaDeCategoria,
} from "@/lib/gestao-de-categorias";
import { Eye, EyeOff, Layers, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
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
const BOTAO_NEUTRO = `${BOTAO} border-white/10 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800 hover:text-white`;
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
  const { renameCategory, deleteCategory, setCategoryActive } = useCategories();

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
      () => setEditando(null),
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
          const uso = descreverUso(c);
          const emUso = categoriaEmUso(c);
          const nestaLinha = ocupado === c.id;
          const esteEdita = editando?.id === c.id;
          const esteApaga = apagando === c.id;
          const valor = editando?.valor ?? "";
          const nomeIgual = esteEdita && valor === c.nome;
          return (
            <li
              key={c.id}
              className="space-y-3 rounded-2xl border border-white/5 bg-zinc-950/60 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
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

              {esteEdita ? (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!nomeIgual && valor.trim() !== "") salvarNome(c, valor);
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
                    type="text"
                    value={valor}
                    maxLength={LIMITE_DO_NOME_DA_CATEGORIA}
                    onChange={(e) =>
                      setEditando({ id: c.id, valor: e.target.value })
                    }
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 text-sm font-bold text-white focus:border-admin-gold focus:outline-none focus:ring-2 focus:ring-admin-gold/30"
                  />
                  {uso ? (
                    <p className="text-xs text-zinc-500">
                      Vão acompanhar o nome novo: {uso}.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={nestaLinha || nomeIgual || valor.trim() === ""}
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
                      disabled={nestaLinha}
                      className={BOTAO_NEUTRO}
                      onClick={() => {
                        setApagando(null);
                        setFalha(null);
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
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
