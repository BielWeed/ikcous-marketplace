// O botão "Novo fornecedor" usa `.produto-principal`, que mora neste CSS. Quem recarrega
// direto nesta tela (2G/economia de dados: o prefetch é barrado) não passou pela tela de
// Produtos, então a tela carrega o que precisa. É CSS só do painel (chunk lazy), nunca da vitrine.
import "@/components/admin/products/catalogo-produtos.css";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  FOCO,
  PERIGO,
  SECUNDARIO,
} from "@/components/admin/coupons/apresentacao";
import { CartaoDoFornecedor } from "@/components/admin/fornecedores/CartaoDoFornecedor";
import { FolhaDoFornecedor } from "@/components/admin/fornecedores/FolhaDoFornecedor";
import { EsqueletoDaLista } from "@/components/admin/primitivos/EsqueletoDaLista";
import { EstadoVazio } from "@/components/admin/primitivos/EstadoVazio";
import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useFocoAposExcluir } from "@/hooks/useFocoAposExcluir";
import {
  mensagemDeErroDosFornecedores,
  useFornecedores,
} from "@/hooks/useFornecedores";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  type DadosDoFornecedor,
  type Fornecedor,
  filtrarFornecedores,
} from "@/lib/fornecedores";
import { cn } from "@/lib/utils";
import { gerarUuidV4 } from "@/lib/uuid-v4";
import type { View } from "@/types";
import { CloudOff, Factory, Plus, RefreshCw, Search, Star } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

interface AdminFornecedoresViewProps {
  /** Contrato das telas do painel; esta tela só abre folhas, não navega para outra. */
  readonly onNavigate?: (view: View, id?: string) => void;
  readonly active?: boolean;
  readonly onSetDirty?: (dirty: boolean) => void;
}

/** O que a folha está fazendo: cadastro novo (com o id já gerado) ou edição. */
type Folha =
  | { readonly tipo: "novo"; readonly id: string }
  | { readonly tipo: "editar"; readonly fornecedor: Fornecedor };

/**
 * "Meus fornecedores" (Central de Fornecedores, E1): quem vende para a loja, com
 * o contato a um toque. Cadastro, edição, favoritos e exclusão ficam só com o
 * administrador da loja (o banco barra o resto); sem internet a tela explica e
 * desliga o que grava.
 */
export const AdminFornecedoresView = memo(function AdminFornecedoresView({
  active = true,
  onSetDirty,
}: AdminFornecedoresViewProps) {
  const {
    fornecedores,
    carregando,
    erro,
    recarregar,
    criar,
    editar,
    favoritar,
    excluir,
  } = useFornecedores(active);
  const offline = useOnlineStatus();
  const foco = useFocoAposExcluir();

  const [busca, setBusca] = useState("");
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [folha, setFolha] = useState<Folha | null>(null);
  const [paraExcluir, setParaExcluir] = useState<Fornecedor | null>(null);

  const visiveis = useMemo(
    () => filtrarFornecedores(fornecedores ?? [], busca, soFavoritos),
    [fornecedores, busca, soFavoritos],
  );
  const filtrando = busca.trim() !== "" || soFavoritos;

  const avisarSujo = useCallback(
    (sujo: boolean) => onSetDirty?.(sujo),
    [onSetDirty],
  );

  const abrirNovo = () => {
    if (offline) return;
    // O id nasce ANTES de gravar: repetir o Salvar regrava a mesma linha (nunca duplica).
    setFolha({ tipo: "novo", id: gerarUuidV4() });
  };

  const salvar = async (dados: DadosDoFornecedor) => {
    if (!folha) return;
    if (folha.tipo === "novo") await criar(folha.id, dados);
    else {
      // A folha guarda a estrela de QUANDO ABRIU. Se o lojista não mexeu nela, a edição não a
      // manda: assim uma estrela que mudou nesse meio tempo (toque na lista, outro aparelho)
      // não é desfeita sem aviso por um valor velho.
      const { favorito, ...semEstrela } = dados;
      await editar(
        folha.fornecedor.id,
        favorito === folha.fornecedor.favorito ? semEstrela : dados,
      );
    }
    toast.success(
      folha.tipo === "novo"
        ? "Fornecedor cadastrado."
        : "Fornecedor atualizado.",
    );
    setFolha(null);
  };

  const aoFavoritar = useCallback(
    (f: Fornecedor) => {
      if (offline) return;
      favoritar(f.id, !f.favorito).catch((e: unknown) => {
        toast.error(mensagemDeErroDosFornecedores(e));
      });
    },
    [favoritar, offline],
  );
  const aoEditar = useCallback(
    (f: Fornecedor) => {
      if (!offline) setFolha({ tipo: "editar", fornecedor: f });
    },
    [offline],
  );
  const aoPedirExclusao = useCallback(
    (f: Fornecedor) => {
      if (!offline) setParaExcluir(f);
    },
    [offline],
  );

  const confirmarExclusao = () => {
    const alvo = paraExcluir;
    if (!alvo) return;
    foco.marcarExclusao();
    setParaExcluir(null);
    excluir(alvo.id).then(
      () => toast.success("Fornecedor excluído."),
      (e: unknown) => toast.error(mensagemDeErroDosFornecedores(e)),
    );
  };

  const semLista = fornecedores === null;
  const textoDoBotaoNovo = offline ? "Sem internet" : "Novo fornecedor";

  return (
    <div className="pb-admin relative h-auto bg-admin-bg font-sans text-zinc-400 duration-500 animate-in fade-in lg:pb-12">
      <div className="sticky top-0 z-20 bg-admin-bg/95 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl [&_h1]:font-bold [&_h1]:normal-case [&_h1]:tracking-tight">
          <AdminPageHeader
            titulo={NOMES_DO_PAINEL["admin-fornecedores"]}
            propsDoTitulo={foco.propsDoTitulo}
          />
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 px-5 pb-6">
        {offline && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl border border-admin-border-strong bg-admin-surface p-4 text-sm text-zinc-200"
          >
            <CloudOff aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <p>
              Sem internet. Dá para consultar o que já está na tela e abrir os
              contatos, mas cadastrar, editar, favoritar e excluir ficam
              desligados até a conexão voltar.
            </p>
          </div>
        )}

        {!semLista && fornecedores.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-zinc-400"
              />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                aria-label="Buscar fornecedor pelo nome"
                placeholder="Buscar pelo nome"
                autoComplete="off"
                className={`h-12 w-full min-w-0 rounded-2xl border border-admin-border-strong bg-admin-raised pl-11 pr-3 text-base text-zinc-50 placeholder:text-zinc-400 ${FOCO}`}
              />
            </div>
            <button
              type="button"
              aria-pressed={soFavoritos}
              onClick={() => setSoFavoritos((v) => !v)}
              className={cn(
                SECUNDARIO,
                "min-h-12",
                soFavoritos && "border-admin-gold text-admin-gold",
              )}
            >
              <Star
                aria-hidden="true"
                className="size-4"
                fill={soFavoritos ? "currentColor" : "none"}
              />
              Favoritos
            </button>
          </div>
        )}

        {carregando && semLista && <EsqueletoDaLista linhas={4} />}

        {!carregando && semLista && erro && (
          <div
            role="alert"
            className="space-y-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4"
          >
            <p className="text-sm font-semibold text-red-200">{erro}</p>
            <button
              type="button"
              onClick={recarregar}
              className={`${PERIGO} w-full`}
            >
              <RefreshCw aria-hidden="true" className="size-4" /> Tentar de novo
            </button>
          </div>
        )}

        {!semLista && fornecedores.length === 0 && (
          <EstadoVazio
            icone={Factory}
            titulo="Você ainda não cadastrou fornecedores"
            frase="Cadastre quem vende para você: o contato fica a um toque."
            acao={
              offline
                ? undefined
                : {
                    rotulo: "Cadastrar o primeiro fornecedor",
                    aoClicar: abrirNovo,
                  }
            }
          />
        )}

        {!semLista &&
          fornecedores.length > 0 &&
          visiveis.length === 0 &&
          filtrando && (
            <EstadoVazio
              icone={soFavoritos && busca.trim() === "" ? Star : Search}
              titulo={
                soFavoritos && busca.trim() === ""
                  ? "Nenhum favorito ainda"
                  : "Nenhum fornecedor encontrado"
              }
              frase={
                soFavoritos && busca.trim() === ""
                  ? "Toque na estrela de um fornecedor para ele ficar aqui."
                  : "Confira o nome digitado ou limpe a busca."
              }
              acao={{
                rotulo: "Limpar filtros",
                aoClicar: () => {
                  setBusca("");
                  setSoFavoritos(false);
                },
              }}
            />
          )}

        {visiveis.length > 0 && (
          <>
            <p className="text-xs text-zinc-400" aria-live="polite">
              {visiveis.length === 1
                ? "1 fornecedor"
                : `${visiveis.length} fornecedores`}
              {filtrando ? " na busca" : ""}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {visiveis.map((f) => (
                <CartaoDoFornecedor
                  key={f.id}
                  fornecedor={f}
                  offline={offline}
                  aoFavoritar={aoFavoritar}
                  aoEditar={aoEditar}
                  aoExcluir={aoPedirExclusao}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <AcaoDaBarra ativa={active !== false} aria-label="Ações dos fornecedores">
        <button
          type="button"
          disabled={offline}
          aria-label={
            offline ? "Novo fornecedor indisponível sem internet" : undefined
          }
          title={
            offline ? "Novo fornecedor indisponível sem internet" : undefined
          }
          onClick={abrirNovo}
          className="produto-principal admin-barra-principal min-w-0 flex-1"
        >
          <Plus aria-hidden="true" className="size-5 shrink-0" />
          <span className="min-w-0">{textoDoBotaoNovo}</span>
        </button>
      </AcaoDaBarra>

      <FolhaDoFornecedor
        aberta={folha !== null}
        fornecedor={folha?.tipo === "editar" ? folha.fornecedor : null}
        offline={offline}
        aoFechar={() => setFolha(null)}
        aoSalvar={salvar}
        aoMudarSujo={avisarSujo}
      />

      <AlertDialog
        open={paraExcluir !== null}
        onOpenChange={(abrir) => !abrir && setParaExcluir(null)}
      >
        <AlertDialogContent
          {...foco.dialogo}
          className="max-w-md rounded-3xl border border-admin-border bg-zinc-950"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words text-2xl font-bold text-zinc-50">
              Excluir {paraExcluir?.nome}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-zinc-400">
              O contato e as observações deste fornecedor serão apagados. Os
              seus produtos não mudam. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className={SECUNDARIO}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmarExclusao} className={PERIGO}>
              Excluir fornecedor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
