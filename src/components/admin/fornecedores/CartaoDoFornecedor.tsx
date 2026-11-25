import {
  FOCO,
  PERIGO,
  SECUNDARIO,
} from "@/components/admin/coupons/apresentacao";
import {
  type Fornecedor,
  linkDoInstagram,
  linkDoSite,
  linkDoWhatsapp,
} from "@/lib/fornecedores";
import { cn } from "@/lib/utils";
import {
  Globe,
  Instagram,
  MessageCircle,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { memo } from "react";

const ATALHO = `inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-admin-border-strong bg-admin-raised px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-admin-hover ${FOCO}`;
const ICONE_DO_CARTAO = `inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-admin-border-strong bg-admin-raised text-zinc-300 hover:bg-admin-hover disabled:cursor-not-allowed disabled:text-zinc-500 ${FOCO}`;

/**
 * Um fornecedor na lista: nome, estrela de favorito e os atalhos de UM toque
 * (WhatsApp, Instagram, Site), que só aparecem quando o campo está preenchido E
 * o valor passa na mesma regra do banco (valor estranho nunca vira link).
 * Links abrem em outra aba, sem passar a origem (`noopener noreferrer`).
 *
 * Os atalhos são links externos: continuam funcionando sem internet do nosso
 * banco. Estrela, editar e excluir gravam, então desligam offline.
 */
export const CartaoDoFornecedor = memo(function CartaoDoFornecedor({
  fornecedor,
  offline,
  aoFavoritar,
  aoEditar,
  aoExcluir,
}: {
  readonly fornecedor: Fornecedor;
  readonly offline: boolean;
  readonly aoFavoritar: (fornecedor: Fornecedor) => void;
  readonly aoEditar: (fornecedor: Fornecedor) => void;
  readonly aoExcluir: (fornecedor: Fornecedor) => void;
}) {
  const { nome, favorito } = fornecedor;
  const whatsapp = linkDoWhatsapp(fornecedor.whatsapp);
  const instagram = linkDoInstagram(fornecedor.instagram);
  const site = linkDoSite(fornecedor.site);
  const onde = [fornecedor.cidade, fornecedor.uf].filter(Boolean).join(" - ");

  return (
    <article
      data-fornecedor-id={fornecedor.id}
      className="min-w-0 space-y-3 rounded-2xl border border-admin-border bg-admin-surface p-4"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-bold leading-snug text-white">
            {nome}
          </h3>
          {onde !== "" && (
            <p className="mt-0.5 break-words text-sm text-zinc-400">{onde}</p>
          )}
        </div>
        <button
          type="button"
          disabled={offline}
          aria-pressed={favorito}
          aria-label={
            favorito ? `Tirar ${nome} dos favoritos` : `Favoritar ${nome}`
          }
          onClick={() => aoFavoritar(fornecedor)}
          className={cn(ICONE_DO_CARTAO, favorito && "text-admin-gold")}
        >
          <Star
            aria-hidden="true"
            className="size-5"
            fill={favorito ? "currentColor" : "none"}
          />
        </button>
      </div>

      {fornecedor.observacoes && (
        <p className="line-clamp-2 whitespace-pre-line break-words text-sm text-zinc-400">
          {fornecedor.observacoes}
        </p>
      )}

      {(whatsapp || instagram || site) && (
        <div className="flex flex-wrap gap-2">
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`WhatsApp de ${nome} (abre em outra aba)`}
              className={ATALHO}
            >
              <MessageCircle aria-hidden="true" className="size-5" /> WhatsApp
            </a>
          )}
          {instagram && (
            <a
              href={instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Instagram de ${nome} (abre em outra aba)`}
              className={ATALHO}
            >
              <Instagram aria-hidden="true" className="size-5" /> Instagram
            </a>
          )}
          {site && (
            <a
              href={site}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Site de ${nome} (abre em outra aba)`}
              className={ATALHO}
            >
              <Globe aria-hidden="true" className="size-5" /> Site
            </a>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={offline}
          aria-label={`Editar ${nome}`}
          onClick={() => aoEditar(fornecedor)}
          className={cn(SECUNDARIO, "flex-1")}
        >
          <Pencil aria-hidden="true" className="size-4" /> Editar
        </button>
        <button
          type="button"
          disabled={offline}
          aria-label={`Excluir ${nome}`}
          onClick={() => aoExcluir(fornecedor)}
          className={cn(PERIGO, "flex-1")}
        >
          <Trash2 aria-hidden="true" className="size-4" /> Excluir
        </button>
      </div>
    </article>
  );
});
