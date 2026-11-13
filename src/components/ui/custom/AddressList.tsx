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
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useVoltarFechaAFolha } from "@/hooks/useVoltarFechaAFolha";
import { queryMapsDoEndereco } from "@/lib/query-maps-do-endereco";
import type { Address } from "@/types";
import { CheckCircle2, Edit, MapPin, Plus, Trash2 } from "lucide-react";
import { memo, useState } from "react";

interface AddressListProps {
  addresses: Address[];
  onEdit?: (address: Address) => void;
  onDelete?: ((id: string) => void) | ((id: string) => Promise<unknown>);
  onSelect?: (address: Address) => void;
  selectedId?: string;
  selectable?: boolean;
  compact?: boolean;
  /** Opt-in do Perfil: mapa por cartão nos detalhes expandidos. O ramo
   * compacto NUNCA monta iframe, e o checkout (selectable) não passa a flag. */
  showMaps?: boolean;
  /** Opt-in do Perfil: com a lista vazia, mostra o botão "Adicionar endereço". */
  onAdd?: () => void;
}

// A query de LOCAL do mapa mora em lib (o painel usa a mesma no pedido).
export { queryMapsDoEndereco };

// Apagar endereço pede confirmação (caçada de 14/10/2026, dado de cliente): a lixeira do cartão é pequena e fica
// colada no lápis, e apagava na hora, sem "tem certeza?". O toque na lixeira só ABRE esta pergunta; quem apaga é o
// botão "Apagar" dela. O texto não promete nada sobre os pedidos já feitos: o que cada pedido guarda do endereço
// depende de quando ele foi feito.
function ConfirmaApagarEndereco({
  endereco,
  onCancelar,
  onConfirmar,
  excluindo,
}: {
  endereco: Address | null;
  onCancelar: () => void;
  onConfirmar: (id: string) => void;
  excluindo: boolean;
}) {
  return (
    <AlertDialog
      open={endereco !== null}
      onOpenChange={(aberto) => {
        if (!aberto && !excluindo) onCancelar();
      }}
    >
      <AlertDialogContent overlayClassName="z-[130]" className="z-[130]">
        <AlertDialogHeader>
          <AlertDialogTitle>Apagar este endereço?</AlertDialogTitle>
          <AlertDialogDescription>
            {endereco
              ? `${endereco.name} — ${endereco.street}, ${endereco.number}. Esta ação não pode ser desfeita.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={excluindo}
            onClick={(evento) => {
              evento.preventDefault();
              if (endereco && !excluindo) onConfirmar(endereco.id);
            }}
          >
            {excluindo ? "Excluindo..." : "Apagar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const AddressList = memo(function AddressList({
  addresses,
  onEdit,
  onDelete,
  onSelect,
  selectedId,
  selectable = false,
  compact = false,
  showMaps = false,
  onAdd,
}: AddressListProps) {
  // `true` = SEM internet (o nome do hook engana). Sem rede o embed do Google
  // mostra a tela de erro do navegador dentro do cartão; o endereço já está em
  // texto logo acima, então só o aviso ocupa o lugar do mapa.
  const semInternet = useOnlineStatus();
  // O endereço cuja lixeira foi tocada, enquanto a pergunta está aberta.
  const [apagando, setApagando] = useState<Address | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  // O Voltar do aparelho cancela só a pergunta (o Perfil fica). Com a exclusão
  // em andamento ela não fecha, como o Esc: `false` devolve a entrada.
  useVoltarFechaAFolha(apagando !== null, () => {
    if (excluindo) return false;
    setApagando(null);
    return true;
  });
  const confirmacao = (
    <ConfirmaApagarEndereco
      endereco={apagando}
      excluindo={excluindo}
      onCancelar={() => setApagando(null)}
      onConfirmar={(id) => {
        if (excluindo) return;
        const resultado = onDelete?.(id);
        if (!resultado) {
          setApagando(null);
          return;
        }
        setExcluindo(true);
        void resultado
          .catch(() => {
            // O responsável pela exclusão informa o erro; a pergunta só espera.
          })
          .finally(() => {
            setExcluindo(false);
            setApagando(null);
          });
      }}
    />
  );

  if (addresses.length === 0) {
    return (
      <div
        className={
          onAdd
            ? "px-4 py-6 text-center"
            : "rounded-lg border border-dashed border-gray-200 bg-gray-50 py-8 text-center"
        }
      >
        <MapPin
          className={
            onAdd
              ? "mx-auto mb-3 size-10 text-muted-foreground"
              : "mx-auto mb-3 size-10 text-gray-300"
          }
        />
        <p
          className={
            onAdd
              ? "text-base font-bold text-foreground"
              : "text-sm text-gray-500"
          }
        >
          Nenhum endereço cadastrado
        </p>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-foreground px-5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
          >
            <Plus aria-hidden="true" className="size-4" />
            Adicionar endereço
          </button>
        )}
      </div>
    );
  }

  // Lista limpa do Perfil: uma linha por endereço, nome + selo, rua e bairro,
  // editar e apagar com alvo de toque de 44 px e nome do endereço no rótulo.
  if (compact && !selectable) {
    return (
      <>
        <ul className="divide-y divide-border">
          {addresses.map((address) => (
            <li key={address.id} className="flex items-center gap-3 py-3">
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-foreground text-background max-[359px]:hidden"
              >
                <MapPin className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="max-w-full break-words text-base font-bold text-foreground">
                    {address.name}
                  </span>
                </div>
                <p className="break-words text-sm text-muted-foreground">
                  {address.street}, {address.number} ·{" "}
                  {address.neighborhood || address.city}
                </p>
                {address.is_default && (
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full bg-emerald-600"
                    />
                    Principal
                  </span>
                )}
              </div>
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(address)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
                  aria-label={`Editar endereço ${address.name}`}
                >
                  <Edit aria-hidden="true" className="size-5" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => setApagando(address)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-red-600 transition-colors hover:bg-muted dark:text-red-400"
                  aria-label={`Excluir endereço ${address.name}`}
                >
                  <Trash2 aria-hidden="true" className="size-5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {confirmacao}
      </>
    );
  }

  if (compact) {
    return (
      <>
        <div className="space-y-2">
          {addresses.map((address) => (
            <div
              key={address.id}
              role={selectable ? "button" : undefined}
              aria-pressed={selectable ? selectedId === address.id : undefined}
              tabIndex={selectable ? 0 : undefined}
              className={`flex items-center justify-between rounded-2xl border px-3 py-2.5 transition-all duration-300 ${
                selectable && selectedId === address.id
                  ? "border-zinc-900 bg-zinc-900/5 shadow-sm"
                  : "border-transparent bg-zinc-50/50 hover:bg-zinc-100/50"
              } ${selectable ? "cursor-pointer active:scale-[0.99]" : ""}`}
              onClick={() => selectable && onSelect?.(address)}
              onKeyDown={(e) => {
                // Só a tecla apertada no próprio cartão escolhe: vinda de um
                // botão interno ela não pode ser engolida.
                if (e.target !== e.currentTarget) return;
                if (selectable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect?.(address);
                }
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <div
                  className={`flex size-7 shrink-0 items-center justify-center rounded-lg shadow-sm ${
                    selectable && selectedId === address.id
                      ? "bg-zinc-900 text-white"
                      : "border border-zinc-100 bg-white text-zinc-400"
                  }`}
                >
                  <MapPin className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="max-w-[220px] truncate text-xs font-bold text-zinc-900">
                      {address.name}
                    </span>
                    {address.is_default && (
                      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-black uppercase tracking-wider text-emerald-700">
                        Principal
                      </span>
                    )}
                    {selectable && selectedId === address.id && (
                      <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-black uppercase tracking-wider text-zinc-900">
                        Selecionado
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 break-words text-xs font-medium text-zinc-600">
                    {address.street}, {address.number} • {address.city}
                  </p>
                </div>
              </div>

              {/* Actions or Selected Indicator */}
              <div className="ml-2 flex shrink-0 items-center gap-1">
                {selectable && selectedId === address.id ? (
                  <CheckCircle2 className="size-3.5 text-zinc-900" />
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {confirmacao}
      </>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {addresses.map((address) => {
          // Seletores (checkout) nunca ganham mapa: mesmo com showMaps passado,
          // selectable bloqueia — o cartão já é interativo e não vira moldura.
          const queryMaps =
            showMaps && !selectable ? queryMapsDoEndereco(address) : null;
          return (
            <div
              key={address.id}
              role={selectable ? "button" : undefined}
              aria-pressed={selectable ? selectedId === address.id : undefined}
              tabIndex={selectable ? 0 : undefined}
              className={`relative rounded-2xl border-2 ${selectable ? "bg-zinc-50/50" : "bg-muted/50"} p-4 transition-all duration-500 sm:p-5 ${
                selectable && selectedId === address.id
                  ? "z-10 border-zinc-900 bg-white shadow-2xl shadow-zinc-100"
                  : selectable
                    ? "border-transparent hover:border-zinc-200 hover:bg-white"
                    : "border-transparent hover:border-border hover:bg-card"
              } ${selectable ? "cursor-pointer active:scale-[0.98]" : ""}`}
              onClick={() => selectable && onSelect?.(address)}
              onKeyDown={(e) => {
                // Só a tecla apertada no próprio cartão escolhe: no Editar e
                // no Excluir o Enter/Espaço tem de virar o clique do botão.
                if (e.target !== e.currentTarget) return;
                if (selectable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect?.(address);
                }
              }}
            >
              {/* Header */}
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className={`flex size-8 items-center justify-center rounded-xl shadow-sm ${selectable && selectedId === address.id ? "bg-zinc-900 text-white" : selectable ? "bg-white text-zinc-400" : "bg-background text-muted-foreground"} shrink-0`}
                  >
                    <MapPin className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <span
                      className={`block break-words text-sm font-bold leading-tight ${selectable ? "text-zinc-900" : "text-foreground"}`}
                    >
                      {address.name}
                    </span>
                    {/* Só o leitor de tela: a borda e o ícone do escolhido
                        não falam. O modo compacto já tem o selo visível. */}
                    {selectable && selectedId === address.id && (
                      <span className="sr-only">Selecionado</span>
                    )}
                    {address.is_default && (
                      <span
                        className={
                          selectable
                            ? "mt-1 block text-[11px] font-bold uppercase tracking-widest text-emerald-700"
                            : "mt-1 block text-xs font-semibold text-emerald-700"
                        }
                      >
                        {selectable
                          ? "Endereço Principal"
                          : "Endereço principal"}
                      </span>
                    )}
                  </div>
                </div>
                {selectable && selectedId === address.id && (
                  <CheckCircle2 className="size-5 shrink-0 text-zinc-900 duration-300 animate-in zoom-in-50" />
                )}
                {(onEdit || onDelete) && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit?.(address);
                      }}
                      className={
                        selectable
                          ? "relative flex size-8 items-center justify-center rounded-lg bg-white text-zinc-600 shadow-sm transition-all after:absolute after:-inset-1.5 after:content-[''] hover:bg-zinc-900 hover:text-white"
                          : "flex size-11 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-muted"
                      }
                      aria-label={`Editar endereço ${address.name}`}
                    >
                      <Edit className={selectable ? "size-3.5" : "size-5"} />
                    </button>
                    {onDelete && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setApagando(address);
                        }}
                        className={
                          selectable
                            ? "relative flex size-8 items-center justify-center rounded-lg bg-white text-red-400 shadow-sm transition-all after:absolute after:-inset-1.5 after:content-[''] hover:bg-red-50 hover:text-red-500"
                            : "flex size-11 items-center justify-center rounded-full text-red-600 transition-colors hover:bg-red-50"
                        }
                        aria-label={`Excluir endereço ${address.name}`}
                      >
                        <Trash2
                          className={selectable ? "size-3.5" : "size-5"}
                        />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Details */}
              <div
                className={
                  selectable
                    ? "space-y-1 pl-11 text-[11px] font-medium text-zinc-500"
                    : "space-y-1 pl-11 text-sm font-medium text-foreground/70"
                }
              >
                <p
                  className={`mb-1 break-words text-xs font-bold uppercase tracking-tighter ${selectable ? "text-zinc-900" : "text-foreground"}`}
                >
                  {address.recipient_name}
                </p>
                <p className="break-words leading-relaxed">
                  {address.street}, {address.number}
                  {address.complement?.trim()
                    ? ` - ${address.complement.trim()}`
                    : ""}
                </p>
                <p className="break-words leading-relaxed">
                  {address.neighborhood}, {address.city} - {address.state}
                </p>
                <p
                  className={
                    selectable
                      ? "mt-1 text-xs font-bold text-zinc-600"
                      : "mt-1 text-sm font-bold text-foreground/70"
                  }
                >
                  CEP: {address.cep}
                </p>
              </div>

              {/* Mapa do endereço (opt-in showMaps, hoje só o Perfil): FORA do
              pl-11 — largura interna inteira do cartão. O iframe é decorativo
              (pointer-events none, tabIndex -1: nada de foco invisível); o
              recorte do topo esconde o chip do embed SEM esconder os créditos
              do rodapé do Google. O link VISÍVEL sob o mapa abre o Google
              Maps em nova aba — com o apelido no nome acessível para
              distinguir os cartões. Recolher os detalhes desmonta o ramo
              expandido → desmonta o mapa. */}
              {queryMaps && semInternet && (
                <div className="mt-3 space-y-1 rounded-xl border border-zinc-100 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    Sem internet
                  </p>
                  <p className="text-sm text-muted-foreground">
                    O mapa volta quando a conexão voltar.
                  </p>
                </div>
              )}
              {queryMaps && !semInternet && (
                <div className="mt-3 overflow-hidden rounded-xl border border-zinc-100">
                  <div className="relative h-40 w-full overflow-hidden">
                    <iframe
                      title={`Mapa do endereço ${address.name}`}
                      src={`https://maps.google.com/maps?q=${queryMaps}&z=15&output=embed`}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      credentialless=""
                      tabIndex={-1}
                      className="pointer-events-none absolute left-0 top-[-56px] block h-[calc(100%+56px)] w-full border-0"
                    />
                  </div>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${queryMaps}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Abrir no Google Maps — endereço ${address.name}`}
                    className="flex min-h-11 items-center justify-center gap-1 bg-zinc-50 p-2 text-sm font-semibold text-zinc-700 transition-colors hover:text-zinc-900"
                  >
                    Abrir no Google Maps
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {confirmacao}
    </>
  );
});
