#!/usr/bin/env node

const { chromium } = require('playwright');
const os = require('os');

console.log('Checking Playwright setup...');
console.log(`Platform: ${os.platform()}`);
console.log(`Architecture: ${os.arch()}`);

(async () => {
  try {
    console.log('\n1. Testing browser launch...');
    const browser = await chromium.launch({ 
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ]
    });
    console.log('✅ Browser launched successfully');
    
    console.log('\n2. Testing page creation...');
    const page = await browser.newPage();
    console.log('✅ Page created successfully');
    
    console.log('\n3. Testing navigation...');
    await page.goto('https://example.com', { waitUntil: 'load', timeout: 10000 });
    console.log('✅ Navigation successful');
    
    await browser.close();
    console.log('\n✅ All checks passed! Playwright is ready to use.');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.message.includes('Executable doesn\'t exist')) {
      console.error('\n📦 Solution: Install Playwright browsers');
      console.error('   Run: npx playwright install chromium');
    } else if (error.message.includes('libnss') || error.message.includes('libatk')) {
      console.error('\n📦 Solution: Install system dependencies');
      console.error('   Run: npx playwright install-deps chromium');
      console.error('   Or on Ubuntu/Debian:');
      console.error('   sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2');
    } else {
      console.error('\n📦 Check the error above and install missing dependencies');
    }
    
    process.exit(1);
  }
})();

