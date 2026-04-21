const fs = require('fs');

function repl(file, search, replace) {
  let content = fs.readFileSync(file, 'utf8');
  // Only replace if it isn't already replaced
  if (!content.includes(replace)) {
    content = content.replace(search, replace);
    fs.writeFileSync(file, content);
    console.log(`Fixed ${file}`);
  }
}

try {
  repl('src/components/ui/chart.tsx', 'const THEMES =', '// eslint-disable-next-line @typescript-eslint/no-unused-vars\nconst THEMES =');
  repl('src/hooks/useLocalFirstState.ts', '} catch (e) {', '} catch (_e) {');
  repl('src/hooks/useWebTransport.ts', '} catch (err) {', '} catch (_err) {');
  repl('src/views/admin/AdminProductFormView.tsx', '} catch (err) {', '} catch (_err) {');
  repl('src/views/admin/AdminPushView.tsx', '} catch (error) {', '} catch (_error) {');
  repl('src/views/customer/ProductView.tsx', '} catch (err) {', '} catch (_err) {');
  repl('test_zod.ts', 'const addressSchema', '// eslint-disable-next-line @typescript-eslint/no-unused-vars\nconst addressSchema');
  console.log('All done!');
} catch (e) {
  console.error(e);
}
