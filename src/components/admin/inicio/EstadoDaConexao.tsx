import { useEstadoDeOperacaoDoPainel } from "@/components/admin/PontoDeOperacao";
import { EstadoComPonto } from "@/components/admin/primitivos/EstadoComPonto";
import type { TomDeEstado } from "@/lib/tons-de-estado";

/**
 * O "Ao vivo" do cabeçalho do Início: pontinho + texto na cor. Os estados são
 * os mesmos de antes (offline · atualizando · falha ao atualizar · conectado),
 * mais "lento" quando a medição do painel diz que a conexão está lenta. O
 * texto visível é curto; a frase inteira de antes continua para o leitor de
 * tela, numa região de status.
 */
export function EstadoDaConexao({
  offline,
  carregando,
  falhou,
}: Readonly<{ offline: boolean; carregando: boolean; falhou: boolean }>) {
  const medicao = useEstadoDeOperacaoDoPainel();
  const lenta = !offline && medicao?.quality === "slow";

  let tom: TomDeEstado = "positivo";
  let visivel = "Ao vivo";
  let complemento = " · conectado";
  if (offline) {
    tom = "negativo";
    visivel = "Sem internet";
    complemento = " · os valores podem estar desatualizados";
  } else if (carregando) {
    tom = "atencao";
    visivel = "Atualizando";
    complemento = " sua loja";
  } else if (falhou) {
    tom = "negativo";
    visivel = "Sem atualizar";
    complemento = " · não foi possível atualizar os números";
  } else if (lenta) {
    tom = "atencao";
    visivel = "Ao vivo · lento";
    complemento = " · conexão lenta";
  }

  return (
    <div role="status" className="text-xs">
      <EstadoComPonto tom={tom} texto={visivel} />
      <span className="sr-only">{complemento}</span>
    </div>
  );
}
