import { useEffect } from 'react';

interface SEOProps {
    title?: string;
    description?: string;
    image?: string;
    url?: string;
    type?: string;
}

export function SEO({
    title = 'IKCOUS Marketplace - O Luxo do Seu Jeito',
    description = 'Descubra a curadoria definitiva de produtos premium com entrega instantânea.',
    image = '/og-image.jpg',
    url = window.location.origin,
    type = 'website'
}: SEOProps) {
    useEffect(() => {
        // Basic Meta Tags
        document.title = title;

        const updateMeta = (name: string, content: string, attr: string = 'name') => {
            let element = document.querySelector(`meta[${attr}="${name}"]`);
            if (!element) {
                element = document.createElement('meta');
                element.setAttribute(attr, name);
                document.head.appendChild(element);
            }
            element.setAttribute('content', content);
        };

        updateMeta('description', description);

        // Open Graph
        updateMeta('og:title', title, 'property');
        updateMeta('og:description', description, 'property');
        updateMeta('og:image', image, 'property');
        updateMeta('og:url', url, 'property');
        updateMeta('og:type', type, 'property');

        // Twitter
        updateMeta('twitter:card', 'summary_large_image');
        updateMeta('twitter:title', title);
        updateMeta('twitter:description', description);
        updateMeta('twitter:image', image);
    }, [title, description, image, url, type]);

    return null; // Este componente não renderiza nada visualmente
}
