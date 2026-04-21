import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', exception => {
    errors.push(exception.message + '\n' + exception.stack);
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.goto('https://ickous-marketplace-pxskor9k2-gabriels-projects-5a19f6ee.vercel.app', { waitUntil: 'load', timeout: 15000 }).catch(() => {});
  
  await page.waitForTimeout(3000);
  console.log('--- ERRORS START ---');
  errors.forEach(e => console.log(e));
  console.log('--- ERRORS END ---');

  await browser.close();
})();
