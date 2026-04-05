import type { Order } from '@/types';

interface OrderReceiptProps {
    order: Order;
}

export function OrderReceipt({ order }: OrderReceiptProps) {
    return (
        <>
            <div className="hidden print:block p-8 text-black bg-white font-mono text-sm max-w-[80mm] mx-auto border border-gray-200">
                <div className="text-center border-b border-dashed border-black pb-4 mb-4">
                    <h2 className="text-xl font-bold uppercase">IKCOUS STORE</h2>
                    <p className="text-xs">Pedido #{order.id.slice(-6)}</p>
                    <p className="text-xs">{order?.createdAt ? new Date(order.createdAt).toLocaleString('pt-BR') : 'Data Indisponível'}</p>
                </div>

                <div className="mb-4">
                    <p className="font-bold border-b border-black mb-1">CLIENTE:</p>
                    <p>{order.customer.name}</p>
                    <p>{order.customer.whatsapp}</p>
                    <p className="text-xs">{order.customer.address}, {order.customer.number}</p>
                    <p className="text-xs">{order.customer.neighborhood}</p>
                </div>

                <div className="mb-4">
                    <p className="font-bold border-b border-black mb-1">ITENS:</p>
                    <div className="space-y-1">
                        {order.items.map((item, i) => (
                            <div key={i} className="flex justify-between">
                                <span className="flex-1">{item.quantity}x {item.name}</span>
                                <span>R$ {((item.price || 0) * (item.quantity || 0)).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="border-t border-dashed border-black pt-4 mb-4">
                    <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span>R$ {(order?.subtotal || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Frete</span>
                        <span>R$ {(order?.shipping || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t border-black">
                        <span>TOTAL</span>
                        <span>R$ {(order?.total || 0).toFixed(2)}</span>
                    </div>
                </div>

                <div className="text-center mt-8 pt-4 border-t border-dashed border-black">
                    <p className="text-xs">Obrigado pela preferência!</p>
                    <p className="text-[10px] text-gray-400 mt-2">www.ikcous.com.br</p>
                </div>
            </div>

            <style>
                {`
                    @media print {
                        body * { visibility: hidden; }
                        .print\\:block, .print\\:block * { visibility: visible; }
                        .print\\:block { 
                            position: absolute; 
                            left: 0; 
                            top: 0; 
                            width: 100% !important; 
                            padding: 20px !important;
                            margin: 0 !important;
                            display: block !important;
                            background: white !important;
                        }
                        nav, footer, button, .sticky, header, [role="banner"] { display: none !important; }
                    }
                `}
            </style>
        </>
    );
}
