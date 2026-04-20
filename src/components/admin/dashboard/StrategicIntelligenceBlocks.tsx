"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { ResponsiveContainer, PieChart, Pie, Cell, Legend, Sector, Label } from 'recharts';
import type { SectorProps } from 'recharts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatCurrency } from '@/lib/utils';

export interface CategoryData {
    name: string;
    value: number;
    color?: string;
    avg_ticket?: number;
    orders?: number;
    gradientId?: string;
    solidColor?: string;
    valueType?: 'currency' | 'number';
}

interface StrategicIntelligenceBlocksProps {
    readonly categoryData: CategoryData[];
    readonly loading: boolean;
}

const PREMIUM_PALETTE = [
    { id: 'cat-gold', color: '#ffbf00' },      // Ouro
    { id: 'cat-cyan', color: '#06b6d4' },      // Ciano
    { id: 'cat-rose', color: '#f43f5e' },      // Rosa 
    { id: 'cat-emerald', color: '#10b981' },   // Esmeralda
    { id: 'cat-purple', color: '#a855f7' },    // Roxo
    { id: 'cat-orange', color: '#f97316' },    // Laranja
    { id: 'cat-blue', color: '#3b82f6' },      // Azul Real
    { id: 'cat-zinc', color: '#a1a1aa' },      // Zinco/Prata
    { id: 'cat-lime', color: '#84cc16' },      // Lima
    { id: 'cat-amber', color: '#f59e0b' },     // Âmbar
];

const GRADIENT_MAP = Object.fromEntries(PREMIUM_PALETTE.map(g => [g.id, g.color]));

// CustomTooltip substituído pelo Card Lateral Flutuante

interface LegendPayloadEntry {
    id?: string;
    type?: string;
    value: string;
    color?: string;
    inactive?: boolean;
    payload?: any;
}

interface CustomLegendProps {
    readonly payload?: LegendPayloadEntry[];
    readonly onClick?: (entry: LegendPayloadEntry) => void;
    readonly onLegendHover?: (name: string | null) => void;
}

const CustomLegend = React.memo(({ payload, onClick, onLegendHover }: CustomLegendProps) => {
    if (!payload?.length) return null;

    return (
        <ul className="flex flex-wrap lg:flex-col justify-center lg:justify-center items-start gap-4 mt-8 lg:mt-0 lg:pl-10">
            {payload.map((entry: LegendPayloadEntry) => {
                const isInactive = entry.inactive;
                const color = isInactive ? '#3f3f46' : entry.color;
                
                return (
                    <li 
                        key={`legend-item-${entry.value}`}
                        className="flex items-center gap-3 group w-full sm:w-auto lg:w-full"
                    >
                        <button
                            type="button"
                            className="flex items-center gap-3 w-full text-left cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-admin-gold/50 rounded-sm"
                            onClick={() => onClick?.(entry)}
                            onMouseEnter={() => onLegendHover?.(entry.value)}
                            onMouseLeave={() => onLegendHover?.(null)}
                            aria-pressed={!isInactive}
                        >
                            <span 
                                className={`flex-shrink-0 w-2.5 h-2.5 rounded-full transition-colors duration-300 ${isInactive ? 'opacity-50' : 'opacity-100'}`}
                                style={{ backgroundColor: color, boxShadow: isInactive ? 'none' : `0 0 8px ${color}80` }}
                                aria-hidden="true"
                            />
                            <span className={`text-[10px] sm:text-[11px] font-black uppercase tracking-[0.1em] transition-colors duration-300 ${isInactive ? 'text-zinc-500' : 'text-zinc-400 group-hover:text-white'}`}>
                                {entry.value}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
});
CustomLegend.displayName = 'CustomLegend';

interface CustomPieLabelProps {
    readonly viewBox?: any;
    readonly totalRevenue: number;
    readonly fontSize: string;
}

const CustomPieLabel = React.memo(({ viewBox, totalRevenue, fontSize }: CustomPieLabelProps) => {
    if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null;
    const { cx, cy } = viewBox;
    return (
        <g>
            <text x={cx} y={cy} dy="-10" textAnchor="middle" dominantBaseline="middle" className="fill-zinc-500 uppercase tracking-[0.2em] font-black text-[10px] opacity-80 pointer-events-none">
                Total
            </text>
            <text x={cx} y={cy} dy="16" textAnchor="middle" dominantBaseline="middle" className={`fill-white italic tracking-tighter font-black shadow-2xl pointer-events-none ${fontSize}`}>
                {formatCurrency(totalRevenue)}
            </text>
        </g>
    );
});
CustomPieLabel.displayName = 'CustomPieLabel';

export function StrategicIntelligenceBlocks({ categoryData, loading }: StrategicIntelligenceBlocksProps) {
    const _isMobile = useMediaQuery('(max-width: 1023px)');
    const [activeIndex, setActiveIndex] = useState(-1);
    const [lastActiveIndex, setLastActiveIndex] = useState(-1);
    const [mounted, setMounted] = useState(false);
    const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        setMounted(true);
        return () => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        };
    }, []);

    const isMobile = mounted ? _isMobile : false;

    // Refactored to reduce JSX cognitive complexity
    const pieLayout = useMemo(() => {
        return isMobile
            ? {
                  innerRadius: 70, outerRadius: 90, cx: "50%", cy: "42%", 
                  fontSize: "text-[18px]", 
                  alignV: "bottom" as const, alignH: "center" as const, layout: "horizontal" as const
              }
            : {
                  innerRadius: 80, outerRadius: 105, cx: "40%", cy: "50%", 
                  fontSize: "text-[20px]", 
                  alignV: "middle" as const, alignH: "right" as const, layout: "vertical" as const
              };
    }, [isMobile]);

    const safeCategoryData = useMemo<CategoryData[]>(() => {
        return (categoryData || []).map((item, index) => {
            // Se excedermos itens, usamos offset
            const safeIndex = index >= PREMIUM_PALETTE.length ? index + Math.floor(index / PREMIUM_PALETTE.length) : index;
            const gradientId = PREMIUM_PALETTE[safeIndex % PREMIUM_PALETTE.length].id;
            return {
                ...item,
                value: Number(item.value) || 0,
                gradientId,
                solidColor: GRADIENT_MAP[gradientId]
            };
        });
    }, [categoryData]);

    const visibleCategoryData = useMemo(() => {
        return safeCategoryData.filter(c => !hiddenCategories.has(c.name));
    }, [safeCategoryData, hiddenCategories]);

    const totalRevenue = useMemo(() => {
        return visibleCategoryData.reduce((acc, curr) => acc + (curr.value || 0), 0);
    }, [visibleCategoryData]);



    const toggleCategory = useCallback((categoryName: string) => {
        setHiddenCategories(prev => {
            const next = new Set(prev);
            if (next.has(categoryName)) {
                next.delete(categoryName);
            } else {
                // Impede esconder se for a única categoria ativa remanescente
                if (safeCategoryData.length - next.size <= 1) {
                    return prev;
                }
                next.add(categoryName);
            }
            return next;
        });
    }, [safeCategoryData.length]);

    const legendPayload = useMemo(() => {
        return safeCategoryData.map((entry) => ({
            id: entry.name,
            type: 'circle' as const,
            value: entry.name,
            color: hiddenCategories.has(entry.name) ? '#3f3f46' : entry.solidColor,
            inactive: hiddenCategories.has(entry.name)
        }));
    }, [safeCategoryData, hiddenCategories]);

    const onPieEnter = useCallback((_: React.MouseEvent | React.TouchEvent, index: number) => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        setActiveIndex(index);
        setLastActiveIndex(index);
    }, []);

    const onPieLeave = useCallback(() => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => {
            setActiveIndex(-1);
        }, 150);
    }, []);

    const onLegendHover = useCallback((categoryName: string | null) => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);

        if (!categoryName) {
            hoverTimeoutRef.current = setTimeout(() => {
                setActiveIndex(-1);
            }, 150);
            return;
        }
        
        const index = visibleCategoryData.findIndex(c => c.name === categoryName);
        setActiveIndex(index);
        if (index !== -1) setLastActiveIndex(index);
    }, [visibleCategoryData]);

    const renderActiveShape = useCallback((props: SectorProps & { payload?: CategoryData }) => {
        const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload } = props;
        const glowColor = payload?.solidColor || '#ffbf00';
        
        return (
            <g>
                <Sector
                    cx={cx}
                    cy={cy}
                    innerRadius={Math.max(0, Number(innerRadius) - 4)}
                    outerRadius={Number(outerRadius) + 8}
                    startAngle={startAngle}
                    endAngle={endAngle}
                    fill={fill}
                    stroke="#09090b"
                    strokeWidth={2}
                    cornerRadius={6}
                    style={{ 
                        outline: 'none',
                        filter: `drop-shadow(0px 8px 16px ${glowColor}70)`,
                        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                    className="focus:outline-none focus:ring-0 focus-visible:outline-none"
                />
            </g>
        );
    }, []);

    if (!mounted || (loading && (!categoryData || categoryData.length === 0))) {
        return (
            <div className="space-y-12 pb-10 sm:pb-20">
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                    <Skeleton className="lg:col-span-5 h-[340px] sm:h-[380px] w-full rounded-[3rem] bg-zinc-800/20 border border-white/5 shadow-lg backdrop-blur-xl relative overflow-hidden" />
                </div>
            </div>
        );
    }

    if (!loading && (safeCategoryData.length === 0 || totalRevenue === 0)) {
        return (
            <div className="flex flex-col items-center justify-center p-12 bg-zinc-950/60 border border-white/5 rounded-[3rem] shadow-2xl backdrop-blur-3xl text-center space-y-4">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center border border-white/10">
                    <PieChartIcon className="text-zinc-500" size={24} />
                </div>
                <div>
                    <h3 className="text-lg font-black text-white">Sem Dados Registrados</h3>
                    <p className="text-sm font-medium text-zinc-500 mt-1 max-w-sm">
                        Nenhuma categoria registrou faturamento no período selecionado.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-12 pb-10 sm:pb-20">
            {/* A11y - Accessibility Layer for Screen Readers */}
            <section className="sr-only" aria-label="Relatório Estratégico de Faturamento" aria-live="polite" aria-atomic="true">
                <h2>Relatório Estratégico de Faturamento</h2>
                <ul>
                    {safeCategoryData.map((cat) => (
                        <li key={`sr-cat-${cat.name}`}>
                            Categoria {cat.name}: {formatCurrency(cat.value || 0)}
                            {cat.avg_ticket ? `, Ticket Médio: ${formatCurrency(cat.avg_ticket)}` : ''}
                        </li>
                    ))}
                </ul>
                <p>Faturamento Total: {formatCurrency(totalRevenue)}</p>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                {/* Performance por Categoria Elite */}
                <Card className="lg:col-span-5 bg-zinc-950/60 border-white/5 border rounded-[3rem] p-5 sm:p-7 shadow-2xl backdrop-blur-3xl relative overflow-hidden group hover:border-admin-gold/10 transition-all duration-700">
                    <div 
                        className="absolute top-0 left-0 w-64 h-64 bg-admin-gold/5 rounded-full -translate-y-1/2 -translate-x-1/2 blur-[100px] group-hover:bg-admin-gold/10 transition-colors duration-1000" 
                        style={{ willChange: 'background-color' }}
                    />
                    <div className="flex items-center justify-between mb-5 relative z-10">
                        <div className="space-y-1">
                            <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-zinc-500">Divisão de Faturamento</h3>
                            <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-tight">Desempenho por Categoria</p>
                        </div>
                        <div className="w-8 h-8 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center group-hover:border-admin-gold/40 transition-colors">
                            <PieChartIcon size={14} className="text-admin-gold" />
                        </div>
                    </div>

                    {/* PAINEL FLUTUANTE DE DETALHES (CARD LATERAL OTIMIZADO) */}
                    {(() => {
                        const show = activeIndex !== -1;
                        const dataIndex = show ? activeIndex : lastActiveIndex;
                        const activeData = dataIndex === -1 ? null : visibleCategoryData[dataIndex];
                        const percentage = activeData && totalRevenue > 0 ? ((activeData.value / totalRevenue) * 100).toFixed(1) : "0.0";
                        
                        let formattedValue = '';
                        if (activeData) {
                            if (activeData.valueType === 'number') {
                                formattedValue = String(activeData.value);
                            } else {
                                formattedValue = formatCurrency(activeData.value || 0);
                            }
                        }
                        
                        return (
                            <>
                                {/* VERSION DESKTOP */}
                                <div 
                                    className={`hidden lg:flex absolute top-1/2 -translate-y-1/2 right-8 z-50 flex-col w-[260px] p-6 rounded-[2rem] bg-zinc-950/90 border border-white/5 shadow-2xl backdrop-blur-3xl border-l-4 pointer-events-none transform origin-right ${
                                        show ? 'opacity-100 translate-x-0 scale-100' : 'opacity-0 translate-x-8 scale-90'
                                    }`}
                                    style={{ 
                                        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                                        willChange: 'transform, opacity',
                                        borderLeftColor: activeData?.solidColor || 'transparent',
                                        boxShadow: show && activeData ? `0 20px 50px -10px ${activeData.solidColor}60` : 'none'
                                    }}
                                >
                                    {activeData && (() => {
                                        const ticketMedioDisplay = activeData.avg_ticket ? formatCurrency(activeData.avg_ticket) : '--';
                                        
                                        let ordersDisplay: string | number = '--';
                                        if (activeData.orders) {
                                            ordersDisplay = activeData.orders;
                                        } else if (activeData.avg_ticket) {
                                            ordersDisplay = Math.max(1, Math.round(activeData.value / activeData.avg_ticket));
                                        }
                                        
                                        return (
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: activeData.solidColor, boxShadow: `0 0 10px ${activeData.solidColor}` }} />
                                                        <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-white line-clamp-1">{activeData.name}</h4>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-zinc-500">{percentage}%</span>
                                                </div>
                                                
                                                <div className="flex justify-between items-end">
                                                    <div>
                                                        <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">Faturamento</p>
                                                        <p className="text-xl font-black italic tracking-tighter" style={{ color: activeData.solidColor }}>
                                                            {formattedValue}
                                                        </p>
                                                    </div>
                                                    
                                                    <div className="flex items-end gap-3 text-right">
                                                        <div>
                                                            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">T. Médio</p>
                                                            <p className="text-[11px] font-black text-white">{ticketMedioDisplay}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Pedidos</p>
                                                            <p className="text-[11px] font-black text-white">{ordersDisplay}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                                
                                {/* VERSION MOBILE */}
                                <div 
                                    className={`lg:hidden absolute bottom-4 left-4 right-4 z-50 flex flex-col p-5 rounded-[1.5rem] bg-zinc-950/90 border border-white/5 shadow-2xl backdrop-blur-3xl border-b-4 pointer-events-none transform origin-bottom ${
                                        show ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'
                                    }`}
                                    style={{ 
                                        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                                        willChange: 'transform, opacity',
                                        borderBottomColor: activeData?.solidColor || 'transparent',
                                        boxShadow: show && activeData ? `0 20px 50px -10px ${activeData.solidColor}60` : 'none'
                                    }}
                                >
                                    {activeData && (() => {
                                        const ticketMedioDisplay = activeData.avg_ticket ? formatCurrency(activeData.avg_ticket) : '--';
                                        
                                        let ordersDisplay: string | number = '--';
                                        if (activeData.orders) {
                                            ordersDisplay = activeData.orders;
                                        } else if (activeData.avg_ticket) {
                                            ordersDisplay = Math.max(1, Math.round(activeData.value / activeData.avg_ticket));
                                        }
                                        
                                        return (
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: activeData.solidColor }} />
                                                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white line-clamp-1">{activeData.name}</h4>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-zinc-500">{percentage}%</span>
                                                </div>
                                                
                                                <div className="flex justify-between items-end">
                                                    <div>
                                                        <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">Faturamento</p>
                                                        <p className="text-lg font-black italic tracking-tighter" style={{ color: activeData.solidColor }}>
                                                            {formattedValue}
                                                        </p>
                                                    </div>
                                                    
                                                    <div className="flex items-end gap-3 text-right">
                                                        <div>
                                                            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">T. Médio</p>
                                                            <p className="text-[11px] font-black text-white">{ticketMedioDisplay}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Pedidos</p>
                                                            <p className="text-[11px] font-black text-white">{ordersDisplay}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </>
                        );
                    })()}

                    <div className="h-[350px] sm:h-[380px] lg:h-[280px] w-full relative z-10 outline-none" aria-hidden="true" style={{ outline: 'none' }}>
                        <ResponsiveContainer width="100%" height="100%" className="focus:outline-none" style={{ outline: 'none' }}>
                            <PieChart className="focus:outline-none" style={{ outline: 'none' }}>
                                <Pie
                                    key={isMobile ? 'mobile-pie' : 'desktop-pie'}
                                    className="focus:outline-none outline-none"
                                    style={{ outline: 'none' }}
                                    activeIndex={activeIndex}
                                    activeShape={renderActiveShape}
                                    data={visibleCategoryData}
                                    innerRadius={pieLayout.innerRadius}
                                    outerRadius={pieLayout.outerRadius}
                                    paddingAngle={2}
                                    cornerRadius={6}
                                    dataKey="value"
                                    stroke="#09090b"
                                    strokeWidth={1.5}
                                    isAnimationActive={true}
                                    animationDuration={800}
                                    animationEasing="ease-out"
                                    cx={pieLayout.cx}
                                    cy={pieLayout.cy}
                                    onMouseEnter={onPieEnter}
                                    onClick={onPieEnter}
                                    onMouseLeave={onPieLeave}
                                    onTouchStart={onPieEnter}
                                >
                                    <Label
                                        content={<CustomPieLabel totalRevenue={totalRevenue} fontSize={pieLayout.fontSize} />}
                                    />
                                    {visibleCategoryData.map((entry, index) => {
                                        return (
                                            <Cell
                                                key={`cell-${entry.name || index}`}
                                                fill={entry.solidColor}
                                                className="cursor-pointer focus:outline-none focus-visible:outline-none outline-none"
                                                style={{ transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)', outline: 'none' }}
                                            />
                                        );
                                    })}
                                </Pie>

                                <Legend
                                    payload={legendPayload}
                                    onClick={(e) => toggleCategory(e.value)}
                                    content={<CustomLegend onLegendHover={onLegendHover} />}
                                    verticalAlign={pieLayout.alignV}
                                    align={pieLayout.alignH}
                                    layout={pieLayout.layout}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </Card>
            </div>

        </div>
    );
}
