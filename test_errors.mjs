import puppeteer from 'puppeteer';

(async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
    page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));
    page.on('requestfailed', request => console.log('BROWSER REQUEST FAILED:', request.url(), request.failure()?.errorText));

    console.log('Navigating...');
    await page.goto('https://ickous-marketplace-abl5gh3gg-gabriels-projects-5a19f6ee.vercel.app', { waitUntil: 'networkidle0' });
    
    console.log('Waiting slightly...');
    await new Promise(r => setTimeout(r, 2000));
    
    console.log('Done.');
    await browser.close();
})();
