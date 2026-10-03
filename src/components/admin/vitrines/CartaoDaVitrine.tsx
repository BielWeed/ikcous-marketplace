import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";
import { Reorder, useDragControls } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  EyeOff,
  GripVertical,
  Hand,
  Tag,
} from "lucide-react";
import {
  QUANTIDADE_PADRAO,
  type SecaoDaHome,
  tipoDaVitrine,
  tituloExibido,
} from "./tipos";

/** Miniaturas que cabem na linha do cartão no celular; o resto vira "+N". */
const MINIATURAS_VISIVEIS = 5;

/**
 * O cartão de UMA vitrine — o mesmo molde para todas (de fábrica ou
 * personalizadas, ligadas ou desligadas): nome, tipo, liga/desliga e as fotos
 * dos produtos. Tocar em qualquer lugar do cartão abre o painel de edição
 * (o botão "esticado" por trás cobre o cartão inteiro; o liga/desliga, as
 * setas e a alça de arrastar ficam POR CIMA dele).
 *
 * Desligada: borda tracejada, fundo vazado, nome e fotos apagados — dá para
 * ver de longe o que a loja não está mostrando.
 */
export function CartaoDaVitrine({
  secao,
  indice,
  total,
  produtosEmExibicao,
  aoAbrir,
  aoAlternarAtiva,
  aoMover,
  aoSoltar,
}: {
  readonly secao: SecaoDaHome;
  readonly indice: number;
  readonly total: number;
  readonly produtosEmExibicao: readonly Product[];
  readonly aoAbrir: (id: string) => void;
  readonly aoAlternarAtiva: (id: string) => void;
  readonly aoMover: (indice: number, direcao: "up" | "down") => void;
  readonly aoSoltar: () => void;
}) {
  const controles = useDragControls();
  const titulo = tituloExibido(secao);
  const { rotulo, Icone } = tipoDaVitrine(secao);
  const escolhidos = secao.productIds?.length ?? 0;
  const maximo = secao.maxItems ?? QUANTIDADE_PADRAO;
  const visiveis = produtosEmExibicao.slice(0, MINIATURAS_VISIVEIS);
  const restantes = produtosEmExibicao.length - visiveis.length;

  return (
    <Reorder.Item
      as="div"
      value={secao}
      dragListener={false}
      dragControls={controles}
      onDragEnd={aoSoltar}
      className="relative list-none"
    >
      <div
        data-testid="cartao-vitrine"
        data-vitrine-id={secao.id}
        data-ativa={secao.active ? "true" : "false"}
        className={cn(
          "relative rounded-2xl border p-3 pl-2 transition-colors",
          secao.active
            ? "border-white/5 bg-zinc-900/40"
            : "border-dashed border-white/10 bg-transparent",
        )}
      >
        <button
          type="button"
          aria-label={`Editar vitrine ${titulo}`}
          onClick={() => aoAbrir(secao.id)}
          className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/60"
        />

        <div className="pointer-events-none relative flex items-center gap-1.5">
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Arrastar vitrine ${titulo} para reordenar`}
            onPointerDown={(evento) => controles.start(evento)}
            className="pointer-events-auto flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-zinc-600 active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>

          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-[15px] font-bold tracking-tight",
                secao.active ? "text-white" : "text-zinc-400",
              )}
            >
              {titulo}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-zinc-400">
              <span className="inline-flex items-center gap-1 rounded-[7px] bg-white/5 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300">
                <Icone className="size-3 text-zinc-400" />
                {rotulo}
              </span>
              <span
                aria-hidden="true"
                className="size-[3px] rounded-full bg-zinc-600"
              />
              {secao.active ? (
                <span className="whitespace-nowrap">
                  {escolhidos > 0 ? `${escolhidos} escolhidos` : "automático"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 whitespace-nowrap text-zinc-500">
                  <EyeOff className="size-3" />
                  oculta da loja
                </span>
              )}
            </div>
          </div>

          <Switch
            checked={secao.active}
            onCheckedChange={() => aoAlternarAtiva(secao.id)}
            aria-label={`Exibir na loja: ${titulo}`}
            className="pointer-events-auto h-[26px] w-11 data-[state=checked]:bg-admin-gold data-[state=unchecked]:bg-zinc-700 [&>span]:ml-0.5 [&>span]:size-5 [&>span]:data-[state=checked]:translate-x-[18px]"
          />
        </div>

        <div
          data-miniaturas
          className={cn(
            "pointer-events-none relative ml-7 mt-3 flex flex-wrap items-center gap-1.5",
            !secao.active && "opacity-40 grayscale",
          )}
        >
          {visiveis.length === 0 ? (
            <span className="flex h-[42px] items-center rounded-[12px] border border-dashed border-white/15 px-3 text-xs font-semibold text-zinc-400">
              Sem produtos
            </span>
          ) : (
            visiveis.map((produto) => (
              <span
                key={produto.id}
                className="relative flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-white/5 bg-zinc-800"
                title={produto.name}
              >
                {produto.images?.[0] ? (
                  <img
                    src={produto.images[0]}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                ) : (
                  <Tag className="size-4 text-zinc-600" />
                )}
              </span>
            ))
          )}
          {restantes > 0 ? (
            <span className="flex size-[42px] shrink-0 items-center justify-center rounded-[12px] bg-white/5 text-xs font-bold text-zinc-300">
              +{restantes}
            </span>
          ) : null}
        </div>

        <div className="pointer-events-none relative ml-7 mt-3 flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "flex h-[30px] items-center whitespace-nowrap rounded-[10px] border border-white/5 bg-white/5 px-2.5 text-xs font-semibold text-zinc-300",
              !secao.active && "opacity-50",
            )}
          >
            Até {maximo}
          </span>
          {escolhidos > 0 ? (
            <span
              className={cn(
                "flex h-[30px] items-center whitespace-nowrap gap-1.5 rounded-[10px] border border-admin-gold/25 bg-admin-gold/10 px-2.5 text-xs font-semibold text-admin-gold",
                !secao.active && "opacity-50",
              )}
            >
              <Hand className="size-3.5" />
              Escolhidos ({escolhidos})
            </span>
          ) : (
            <span
              className={cn(
                "flex h-[30px] items-center whitespace-nowrap rounded-[10px] border border-white/5 bg-white/5 px-2.5 text-xs font-semibold text-zinc-300",
                !secao.active && "opacity-50",
              )}
            >
              Escolher produtos
            </span>
          )}

          <div className="pointer-events-auto ml-auto flex gap-1">
            <button
              type="button"
              onClick={() => aoMover(indice, "up")}
              disabled={indice === 0}
              aria-label={`Subir vitrine ${titulo}`}
              title="Subir"
              className="flex size-[30px] items-center justify-center rounded-[10px] border border-white/5 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => aoMover(indice, "down")}
              disabled={indice === total - 1}
              aria-label={`Descer vitrine ${titulo}`}
              title="Descer"
              className="flex size-[30px] items-center justify-center rounded-[10px] border border-white/5 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <ArrowDown className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </Reorder.Item>
  );
}
