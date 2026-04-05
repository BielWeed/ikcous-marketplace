import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, Sector } from 'recharts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardStats } from '@/hooks/useAnalytics';

interface StrategicIntelligenceBlocksProps {
    readonly stats: DashboardStats | null;
    readonly categoryData: any[];
    readonly loading: boolean;
}

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload?.length) {
        return (
            <div className="bg-zinc-950/90 border border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-xl">
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 border-b border-white/5 pb-2">
                    {label}
                </p>
                <div className="space-y-1">
                    {payload.map((entry: any) => (
                        <div key={`tooltip-item-${entry.name}`}>
                            <p className="text-sm font-black text-white flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
                                {entry.name}: {entry.name?.includes('Faturamento')
                                    ? `R$ ${(entry.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                                    : entry.value}
                            </p>
                        </div>
                    ))}
                    {payload[0]?.payload?.avg_ticket > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/5">
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">Ticket Médio do Dia</p>
                            <p className="text-sm font-black text-admin-gold">
                                R$ {payload[0].payload.avg_ticket.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        );
    }
    return null;
};

export function StrategicIntelligenceBlocks({ stats, categoryData, loading }: StrategicIntelligenceBlocksProps) {
    const [isMobile, setIsMobile] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);

    const totalRevenue = categoryData.reduce((acc, curr) => acc + (curr.value || 0), 0);

    const onPieEnter = (_: any, index: number) => {
        setActiveIndex(index);
    };

    const renderActiveShape = (props: any) => {
        const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
        
        return (
            <g>
                <Sector
                    cx={cx}
                    cy={cy}
                    innerRadius={innerRadius}
                    outerRadius={outerRadius + 8}
                    startAngle={startAngle}
                    endAngle={endAngle}
                    fill={fill}
                    className="drop-shadow-[0_0_15px_rgba(255,191,0,0.3)] transition-all duration-300"
                    style={{ transition: 'all 0.3s ease-out' }}
                />
            </g>
        );
    };

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 1024);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);
    if (loading && !stats) {
        return (
            <div className="grid grid-cols-1 gap-6">
                <Skeleton className="h-[400px] w-full rounded-[3rem] bg-white/5" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Skeleton className="h-[300px] w-full rounded-[3rem] bg-white/5" />
                    <Skeleton className="h-[300px] w-full rounded-[3rem] bg-white/5" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-12 pb-10 sm:pb-20">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                {/* Performance por Categoria Elite */}
                <Card className="lg:col-span-5 bg-zinc-950/60 border-white/5 border rounded-[3rem] p-5 sm:p-7 shadow-2xl backdrop-blur-3xl relative overflow-hidden group hover:border-admin-gold/10 transition-all duration-700">
                    <div className="absolute top-0 left-0 w-64 h-64 bg-admin-gold/5 rounded-full -translate-y-1/2 -translate-x-1/2 blur-[100px] group-hover:bg-admin-gold/10 transition-all duration-1000" />
                    <div className="flex items-center justify-between mb-5 relative z-10">
                        <div className="space-y-1">
                            <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-zinc-500">Divisão de Faturamento</h3>
                            <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-tight">Desempenho por Categoria</p>
                        </div>
                        <div className="w-8 h-8 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center group-hover:border-admin-gold/40 transition-colors">
                            <PieChartIcon size={14} className="text-admin-gold" />
                        </div>
                    </div>
                    <div className="h-[220px] sm:h-[240px] w-full relative z-10">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <defs>
                                    <linearGradient id="gradientGold" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#ffbf00" stopOpacity={1} />
                                        <stop offset="100%" stopColor="#d97706" stopOpacity={1} />
                                    </linearGradient>
                                    <linearGradient id="gradientYellow" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#fde047" stopOpacity={1} />
                                        <stop offset="100%" stopColor="#ca8a04" stopOpacity={1} />
                                    </linearGradient>
                                    <linearGradient id="gradientOrange" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#fbbf24" stopOpacity={1} />
                                        <stop offset="100%" stopColor="#92400e" stopOpacity={1} />
                                    </linearGradient>
                                    <linearGradient id="gradientBrown" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#78350f" stopOpacity={1} />
                                        <stop offset="100%" stopColor="#451a03" stopOpacity={1} />
                                    </linearGradient>
                                </defs>
                                <Pie
                                    activeIndex={activeIndex}
                                    activeShape={renderActiveShape}
                                    data={categoryData}
                                    innerRadius={isMobile ? 45 : 60}
                                    outerRadius={isMobile ? 75 : 95}
                                    paddingAngle={6}
                                    dataKey="value"
                                    stroke="none"
                                    animationBegin={200}
                                    animationDuration={1500}
                                    cx={isMobile ? "50%" : "40%"}
                                    cy="50%"
                                    onMouseEnter={onPieEnter}
                                    onMouseLeave={() => setActiveIndex(-1)}
                                >
                                    {categoryData.map((_entry, index) => {
                                        let gradientId = 'gradientBrown';
                                        if (index === 0) gradientId = 'gradientGold';
                                        else if (index === 1) gradientId = 'gradientYellow';
                                        else if (index === 2) gradientId = 'gradientOrange';
                                        
                                        return (
                                        <Cell
                                            key={`cell-${_entry.name || index}`}
                                            fill={`url(#${gradientId})`}
                                            className="transition-all duration-500 cursor-pointer"
                                        />
                                    )})}
                                </Pie>

                                {!isMobile && (
                                    <text 
                                        x="40%" 
                                        y="50%" 
                                        textAnchor="middle" 
                                        dominantBaseline="middle"
                                        className="fill-zinc-500 pointer-events-none"
                                    >
                                        <tspan x="40%" dy="-1.2em" fontSize="10" fontWeight="900" className="uppercase tracking-[0.2em] opacity-40">Total</tspan>
                                        <tspan x="40%" dy="1.5em" fontSize="16" fontWeight="900" className="fill-white italic tracking-tighter shadow-2xl">
                                            R$ {totalRevenue.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                                        </tspan>
                                    </text>
                                )}
                                <Tooltip content={<CustomTooltip />} />
                                <Legend
                                    verticalAlign={isMobile ? "bottom" : "middle"}
                                    align={isMobile ? "center" : "right"}
                                    layout={isMobile ? "horizontal" : "vertical"}
                                    iconType="circle"
                                    wrapperStyle={isMobile ? {
                                        fontSize: '9px',
                                        fontWeight: 900,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.1em',
                                        paddingTop: '20px',
                                        color: '#a1a1aa'
                                    } : { 
                                        fontSize: '10px', 
                                        fontWeight: 900, 
                                        textTransform: 'uppercase', 
                                        letterSpacing: '0.15em', 
                                        paddingLeft: '20px', 
                                        color: '#a1a1aa' 
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </Card>
            </div>

        </div>
    );
}
