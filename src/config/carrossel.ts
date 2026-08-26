// Limite de carga das listas que alimentam os carrosséis da Home.
//
// POR QUE EXISTE (defeito confirmado na revisão cruzada 20260825-1050): os
// cortes viviam espalhados como literais — `.slice(0, 6)` nos lançamentos e
// `.slice(0, 10)` nas ofertas/mais vendidos. O 6 travava a vitrine mesmo com
// o seletor de maxItems pedindo 8 ou 10 (o lojista VIA 10 na prévia do admin
// e o cliente via 6); e os 10 das outras listas só estavam certos POR
// COINCIDÊNCIA — eram o maior valor do seletor, não um limite desenhado.
//
// REGRA: este número tem de ser >= ao maior valor oferecido pelo seletor de
// maxItems em AdminCarouselsView. O corte REAL por seção (o `max` que o
// lojista escolheu) continua sendo aplicado no render da Home.
export const LIMITE_MAX_ITENS_CARROSSEL = 10;
