import { useEffect, useRef } from "react";

// Intervalo mínimo entre duas releituras disparadas pelo "voltar ao app": a
// mesma régua dos outros contextos (favoritos, avisos), só que mais larga —
// endereço muda raramente e cada tela montada teria o seu listener.
export const INTERVALO_MIN_RELEITURA_ENDERECOS_MS = 30_000;

type Buscar = (opcoes?: { silencioso?: boolean }) => Promise<void> | void;

// RELÊ OS ENDEREÇOS QUANDO A CLIENTE VOLTA. Carrinho e Perfil ficam montados
// no fundo e `fetchAddresses` só rodava ao montar: a cliente que corrigia o
// CEP (ou apagava um endereço) no celular voltava ao tablet e via o frete e a
// lista ANTIGOS. Duas voltas contam:
//  - a aba volta a ser a visível (`ativa` vira true) — uma leitura por volta;
//  - o app volta do segundo plano (visibilitychange) — só na tela ativa, para
//    as telas montadas não dispararem a mesma consulta quatro vezes, e não
//    antes de `INTERVALO_MIN_RELEITURA_ENDERECOS_MS` da última leitura.
// A releitura é silenciosa: sem rede, a lista que a tela já tem continua.
// A leitura de montagem é da própria tela (ela chama `buscar` no efeito dela);
// aqui ela conta como a última, para a guarda de tempo.
export function useReleituraDosEnderecosAoVoltar(
  usuarioId: string | null | undefined,
  ativa: boolean,
  buscar: Buscar,
) {
  // Carimbado pelo efeito abaixo na montagem (`Date.now` não roda no render).
  const ultimaLeituraEmRef = useRef(0);
  const eraAtivaRef = useRef(ativa);

  // Troca de conta: a tela relê pelo efeito dela; a guarda recomeça daí.
  useEffect(() => {
    ultimaLeituraEmRef.current = Date.now();
  }, [usuarioId]);

  useEffect(() => {
    const voltou = ativa && !eraAtivaRef.current;
    eraAtivaRef.current = ativa;
    if (!voltou || !usuarioId) return;
    ultimaLeituraEmRef.current = Date.now();
    void buscar({ silencioso: true });
  }, [ativa, usuarioId, buscar]);

  useEffect(() => {
    if (!usuarioId || !ativa || typeof document === "undefined") return;
    const aoFicarVisivel = () => {
      if (document.visibilityState !== "visible") return;
      const agora = Date.now();
      if (
        agora - ultimaLeituraEmRef.current <
        INTERVALO_MIN_RELEITURA_ENDERECOS_MS
      ) {
        return;
      }
      ultimaLeituraEmRef.current = agora;
      void buscar({ silencioso: true });
    };
    document.addEventListener("visibilitychange", aoFicarVisivel);
    return () =>
      document.removeEventListener("visibilitychange", aoFicarVisivel);
  }, [usuarioId, ativa, buscar]);
}
