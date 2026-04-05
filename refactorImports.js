const fs = require('node:fs');
const path = require('path');

const srcDir = path.join(process.cwd(), 'src');

function walk(dir, call) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath, call);
        } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
            call(fullPath);
        }
    }
}

walk(srcDir, (file) => {
    if (file === path.join(srcDir, 'contexts', 'AuthContext.tsx')) return;
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    if (content.match(/useAuth/) && content.match(/@\/contexts\/AuthContext/)) {
        content = content.replace(/import\s+\{([^}]*)\}\s+from\s+['\"]@\/contexts\/AuthContext['\"]/g, (match, imports) => {
            const hasProvider = !!imports.match(/\bAuthProvider\b/);
            const hasHook = !!imports.match(/\buseAuth\b/);
            if (hasProvider && hasHook) {
                return `import { AuthProvider } from '@/contexts/AuthContext';\nimport { useAuth } from '@/hooks/useAuth';`;
            } else if (hasHook) {
                return `import { useAuth } from '@/hooks/useAuth';`;
            }
            return match;
        });
        changed = true;
    }
    if (changed) fs.writeFileSync(file, content);
});

walk(srcDir, (file) => {
    if (file === path.join(srcDir, 'contexts', 'NotificationContext.tsx')) return;
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    if (content.match(/useNotificationCenter/) && content.match(/@\/contexts\/NotificationContext/)) {
        content = content.replace(/import\s+\{([^}]*)\}\s+from\s+['\"]@\/contexts\/NotificationContext['\"]/g, (match, imports) => {
            const hasProvider = !!imports.match(/\bNotificationProvider\b/);
            const hasHook = !!imports.match(/\buseNotificationCenter\b/);
            if (hasProvider && hasHook) {
                return `import { NotificationProvider } from '@/contexts/NotificationContext';\nimport { useNotificationCenter } from '@/hooks/useNotificationCenter';`;
            } else if (hasHook) {
                return `import { useNotificationCenter } from '@/hooks/useNotificationCenter';`;
            }
            return match;
        });
        changed = true;
    }
    if (changed) fs.writeFileSync(file, content);
});

walk(srcDir, (file) => {
    if (file === path.join(srcDir, 'contexts', 'StoreContext.tsx')) return;
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    if (content.match(/useStore/) && content.match(/@\/contexts\/StoreContext/)) {
        content = content.replace(/import\s+\{([^}]*)\}\s+from\s+['\"]@\/contexts\/StoreContext['\"]/g, (match, imports) => {
            const hasProvider = !!imports.match(/\bStoreProvider\b/);
            const hasHook = !!imports.match(/\buseStore\b/);
            if (hasProvider && hasHook) {
                return `import { StoreProvider } from '@/contexts/StoreContext';\nimport { useStore } from '@/hooks/useStore';`;
            } else if (hasHook) {
                return `import { useStore } from '@/hooks/useStore';`;
            }
            return match;
        });
        changed = true;
    }
    if (changed) fs.writeFileSync(file, content);
});

// 4. Rewrite CartContext imports
walk(srcDir, (file) => {
    if (file === path.join(srcDir, 'contexts', 'CartContext.tsx')) return;
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    if (content.match(/useCartContext/) && content.match(/@\/contexts\/CartContext/)) {
        content = content.replace(/import\s+\{([^}]*)\}\s+from\s+['\"]@\/contexts\/CartContext['\"]/g, (match, imports) => {
            const hasProvider = !!imports.match(/\bCartProvider\b/);
            const hasHook = !!imports.match(/\buseCartContext\b/);
            if (hasProvider && hasHook) {
                return `import { CartProvider } from '@/contexts/CartContext';\nimport { useCartContext } from '@/hooks/useCart';`;
            } else if (hasHook) {
                return `import { useCartContext } from '@/hooks/useCart';`;
            }
            return match;
        });
        changed = true;
    }
    if (changed) fs.writeFileSync(file, content);
});

console.log('Refactoring finished!');
