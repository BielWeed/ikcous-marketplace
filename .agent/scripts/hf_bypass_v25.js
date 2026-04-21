const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const axios = require('axios');

async function run() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log('Navigating to HF Join...');
        await page.goto('https://huggingface.co/join', { waitUntil: 'networkidle' });
        
        // Wait for AWS WAF if present
        if (await page.content().then(c => c.includes('amzn-captcha-verify-button'))) {
            console.log('AWS WAF Detected. Attempting Direct ID Click...');
            await page.click('#amzn-captcha-verify-button', { timeout: 10000, force: true }).catch(() => console.log('Button click failed.'));
            console.log('WAF Button Clicked. Waiting for transition...');
            await page.waitForTimeout(5000);
        }

        await page.waitForSelector('input[placeholder="Email address"]', { timeout: 15000 });
        
        console.log(`Identity Genesis: ${email}`);
        
        await page.fill('input[placeholder="Email address"]', email);
        await page.fill('input[placeholder="Password"]', require('node:crypto').randomBytes(12).toString('hex') + '!Aa1');
        await page.click('button:has-text("Next")');

        await page.waitForTimeout(2000);
        console.log('Step 2: Profile setup...');
        await page.fill('input[name="username"]', 'ninja_' + Math.random().toString(36).slice(2, 8));
        await page.fill('input[name="fullname"]', 'Ninja Bot V25');
        await page.click('button:has-text("Create Account")');

        console.log('Waiting for verification redirect...');
        await page.waitForLoadState('networkidle');
        
        await page.screenshot({ path: 'hf_signup_result.png' });
        console.log('Signup Initiated. Check inbox.');
        
    } catch (e) {
        console.error('Bypass Failed:', e.message);
        await page.screenshot({ path: 'hf_bypass_error.png' });
    } finally {
        await browser.close();
    }
}

run();
