import { Helmet } from 'react-helmet-async';

interface JsonLdProps {
    data: Record<string, unknown>;
}

/**
 * JsonLd component for injecting structured data (Schema.org) into the page.
 * This is crucial for GEO (Generative Engine Optimization) to help AI search engines
 * and bots understand content context.
 */
export function JsonLd({ data }: JsonLdProps) {
    return (
        <Helmet>
            <script type="application/ld+json">
                {JSON.stringify(data)}
            </script>
        </Helmet>
    );
}
