const http = require('http');
const url = require('url');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { downloadFacebookImage } = require('./i.js');

const PORT = process.env.PORT || 4561;
const DATA_DIR = './data';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper function to wait/delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Global browser instance (reused across requests)
let globalBrowser = null;
let globalPage = null;

// Function to login to Facebook and keep browser open
async function loginToFacebook() {
  let browser;
  try {
    console.log('🌐 Logging into Facebook.com...');
    
    // Find system Chrome/Chromium first
    const possiblePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    
    let executablePath = null;
    for (const chromePath of possiblePaths) {
      if (fs.existsSync(chromePath)) {
        executablePath = chromePath;
        break;
      }
    }
    
    const launchOptions = {
      headless: false,
      defaultViewport: { width: 1280, height: 720 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--start-maximized'
      ],
      timeout: 60000,
      slowMo: 100
    };
    
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });
    
    console.log('📄 Navigating to Facebook.com...');
    await page.goto('https://www.facebook.com', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    await delay(3000);
    
    // Check if login screen appears and login if needed
    console.log('🔍 Checking for login screen...');
    try {
      // Find all text inputs on the page
      const textInputs = await page.$$('input[type="text"], input[type="email"], input:not([type])');
      const passwordInputs = await page.$$('input[type="password"]');
      
      console.log(`Found ${textInputs.length} text input(s) and ${passwordInputs.length} password input(s)`);
      
      // Find email input (first text input that's not password)
      let emailField = null;
      let passwordField = null;
      
      // Try multiple selectors for email field
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[id="email"]',
        'input[placeholder*="Email" i]',
        'input[placeholder*="Phone" i]',
        'input[placeholder*="Mobile" i]',
        'input[autocomplete="username"]',
        'input[autocomplete="email"]'
      ];
      
      for (const selector of emailSelectors) {
        emailField = await page.$(selector);
        if (emailField) {
          console.log(`✅ Found email field using selector: ${selector}`);
          break;
        }
      }
      
      // If not found by specific selectors, use first text input
      if (!emailField && textInputs.length > 0) {
        emailField = textInputs[0];
        console.log('✅ Using first text input as email field');
      }
      
      // Find password input
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="pass"]',
        'input[id="pass"]',
        'input[autocomplete="current-password"]'
      ];
      
      for (const selector of passwordSelectors) {
        passwordField = await page.$(selector);
        if (passwordField) {
          console.log(`✅ Found password field using selector: ${selector}`);
          break;
        }
      }
      
      // If not found by specific selectors, use first password input
      if (!passwordField && passwordInputs.length > 0) {
        passwordField = passwordInputs[0];
        console.log('✅ Using first password input');
      }
      
      // Find login button - try multiple strategies
      let loginButton = null;
      
      // Strategy 1: Try common selectors
      const loginButtonSelectors = [
        'button[type="submit"][name="login"]',
        'button[name="login"]',
        'button[id="loginbutton"]',
        'button[id*="login"]',
        'input[type="submit"][name="login"]',
        'input[type="submit"][value*="Log" i]',
        'button[type="submit"]',
        'button[data-testid*="login"]',
        'form button[type="submit"]',
        'form[method="post"] button',
        'button[aria-label*="Log" i]',
        'button[title*="Log" i]'
      ];
      
      for (const selector of loginButtonSelectors) {
        try {
          loginButton = await page.$(selector);
          if (loginButton) {
            console.log(`✅ Found login button using selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Some selectors might not be supported, continue
        }
      }
      
      // Strategy 2: Find button in the same form as email/password fields
      if (!loginButton && emailField) {
        try {
          const form = await emailField.evaluateHandle(el => {
            let current = el;
            while (current && current.tagName !== 'FORM') {
              current = current.parentElement;
            }
            return current;
          });
          
          if (form && form.asElement()) {
            const formButtons = await form.asElement().$$('button[type="submit"], button, input[type="submit"]');
            if (formButtons.length > 0) {
              loginButton = formButtons[0];
              console.log('✅ Found login button in the same form as email field');
            }
          }
        } catch (e) {
          console.log('   Could not find button in form:', e.message);
        }
      }
      
      // Strategy 3: Find by text content using evaluate
      if (!loginButton) {
        const buttonInfo = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
          for (const btn of buttons) {
            const text = (btn.textContent || btn.value || btn.innerText || '').trim();
            const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
            const title = (btn.getAttribute('title') || '').trim();
            
            if (/log\s*in/i.test(text) || /log\s*in/i.test(ariaLabel) || /log\s*in/i.test(title)) {
              // Return selector that can be used to find this button
              if (btn.id) return `#${btn.id}`;
              if (btn.name) return `${btn.tagName.toLowerCase()}[name="${btn.name}"]`;
              if (btn.className && typeof btn.className === 'string') {
                const classes = btn.className.split(' ').filter(c => c && c !== '').slice(0, 3).join('.');
                if (classes) return `${btn.tagName.toLowerCase()}.${classes}`;
              }
              // Return text content as fallback identifier
              return { text: text || ariaLabel || title, tagName: btn.tagName };
            }
          }
          return null;
        });
        
        if (buttonInfo) {
          if (typeof buttonInfo === 'string') {
            loginButton = await page.$(buttonInfo);
            if (loginButton) {
              console.log(`✅ Found login button by text content using selector: ${buttonInfo}`);
            }
          } else {
            // Try to find by tag name and text
            const allButtons = await page.$$(buttonInfo.tagName.toLowerCase());
            for (const btn of allButtons) {
              const text = await page.evaluate(el => {
                return (el.textContent || el.value || el.innerText || el.getAttribute('aria-label') || '').trim();
              }, btn);
              if (/log\s*in/i.test(text)) {
                loginButton = btn;
                console.log(`✅ Found login button by text: "${text}"`);
                break;
              }
            }
          }
        }
      }
      
      // Strategy 4: Find any submit button near the password field
      if (!loginButton && passwordField) {
        try {
          // Get all buttons on the page and find one that's near the password field
          const allButtons = await page.$$('button, input[type="submit"]');
          const passwordBox = await passwordField.boundingBox();
          
          if (passwordBox && allButtons.length > 0) {
            for (const btn of allButtons) {
              const btnBox = await btn.boundingBox();
              if (btnBox) {
                // Check if button is below the password field (within reasonable distance)
                const verticalDistance = btnBox.y - (passwordBox.y + passwordBox.height);
                if (verticalDistance > 0 && verticalDistance < 100) {
                  loginButton = btn;
                  console.log('✅ Found login button near password field');
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.log('   Could not find button by position:', e.message);
        }
      }

      if (emailField && passwordField && loginButton) {
        console.log('🔐 Login screen detected. Attempting to login...');
        
        // Clear and fill email
        await emailField.click({ clickCount: 3 }); // Select all
        await emailField.type('darshana.saluka.pc2@gmail.com', { delay: 50 });
        console.log('✅ Email entered: darshana.saluka.pc2@gmail.com');
        
        // Clear and fill password
        await passwordField.click({ clickCount: 3 }); // Select all
        await passwordField.type('%-3cgA*zirn5G9X', { delay: 50 });
        console.log('✅ Password entered');
        
        await delay(500); // Small delay before clicking
        
        // Click login button - try multiple methods
        try {
          // Method 1: Regular click
          await loginButton.click();
          console.log('✅ Login button clicked');
        } catch (error) {
          // Method 2: Click using JavaScript
          console.log('⚠️  Regular click failed, trying JavaScript click...');
          await loginButton.evaluate((btn) => {
            if (btn.click) {
              btn.click();
            } else if (btn.dispatchEvent) {
              const event = new MouseEvent('click', { bubbles: true, cancelable: true });
              btn.dispatchEvent(event);
            }
          });
          console.log('✅ Login button clicked via JavaScript');
        }
        
        // Also try pressing Enter on the password field as backup
        await delay(300);
        try {
          await passwordField.press('Enter');
          console.log('✅ Also pressed Enter on password field');
        } catch (e) {
          // Enter press is optional, continue anyway
        }
        
        console.log('⏳ Waiting for login to complete...');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await delay(3000);
        
        console.log('✅ Login process completed!');
      } else {
        console.log('ℹ️  Login form not found. Missing elements:');
        if (!emailField) console.log('   - Email field not found');
        if (!passwordField) console.log('   - Password field not found');
        if (!loginButton) console.log('   - Login button not found');
        console.log('ℹ️  Already logged in or page loaded differently.');
      }
    } catch (error) {
      console.log('ℹ️  Login check error:', error.message);
    }
    
    console.log('✅ Facebook login completed! Browser will remain open for reuse.');
    
    // Keep browser and page open for reuse
    globalBrowser = browser;
    globalPage = page;
    return { success: true, message: 'Facebook login completed', browser, page };
    
  } catch (error) {
    console.error('❌ Error logging into Facebook:', error.message);
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}

// Function to process a Facebook photo URL - extract number and download image
async function processPhotoUrl(photoUrl) {
  if (!globalBrowser || !globalPage) {
    throw new Error('Browser not initialized. Please ensure login is completed first.');
  }
  
  const page = globalPage;
  let extractedNumber = null;
  let imagePath = null;
  
  try {
    console.log(`📸 Navigating to photo URL: ${photoUrl}`);
    await page.goto(photoUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    await delay(3000); // Wait for page to fully load
    console.log('✅ Successfully navigated to photo page!');
    
    // Extract the number from the span element
    console.log('🔍 Looking for number in span element...');
    try {
      // Wait a bit for the page to fully render
      await delay(2000);
      
      // Try multiple times with different selectors
      let number = null;
      const selectors = [
        'span.x135b78x',
        'span[class*="x135b78x"]',
        'span[class="x135b78x"]'
      ];
      
      for (const selector of selectors) {
        try {
          number = await page.evaluate((sel) => {
            const span = document.querySelector(sel);
            if (span) {
              const text = span.textContent.trim();
              // Accept text with numbers and letters (like "145K", "1.2K", "1M", etc.)
              // Also accept pure numbers
              if (text && (/^\d+[KMB]?$/i.test(text) || /^\d+\.?\d*[KMB]?$/i.test(text) || /^\d+$/.test(text))) {
                return text;
              }
            }
            return null;
          }, selector);
          
          if (number) {
            console.log(`✅ Found span element using selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // Fallback: search all spans with similar class pattern
      if (!number) {
        number = await page.evaluate(() => {
          const spans = Array.from(document.querySelectorAll('span[class*="x135"]'));
          for (const s of spans) {
            const text = s.textContent.trim();
            // Accept text with numbers and letters (like "145K", "1.2K", "1M", etc.)
            if (text && (/^\d+[KMB]?$/i.test(text) || /^\d+\.?\d*[KMB]?$/i.test(text) || /^\d+$/.test(text))) {
              return text;
            }
          }
          return null;
        });
      }
      
      // Additional fallback: try to find the nested structure
      if (!number) {
        number = await page.evaluate(() => {
          // Look for the nested structure: span > span > span.x135b78x
          const parentSpans = Array.from(document.querySelectorAll('span[aria-hidden="true"]'));
          for (const parentSpan of parentSpans) {
            const nestedSpan = parentSpan.querySelector('span span.x135b78x');
            if (nestedSpan) {
              const text = nestedSpan.textContent.trim();
              if (text && (/^\d+[KMB]?$/i.test(text) || /^\d+\.?\d*[KMB]?$/i.test(text) || /^\d+$/.test(text))) {
                return text;
              }
            }
          }
          return null;
        });
      }
      
      if (number) {
        extractedNumber = number;
        console.log(`\n${'='.repeat(50)}`);
        console.log(`📊 NUMBER FOUND: ${number}`);
        console.log(`${'='.repeat(50)}\n`);
      } else {
        console.log('⚠️  Could not find the number in span element');
      }
    } catch (error) {
      console.error('⚠️  Error extracting number:', error.message);
    }
    
    // Extract and download the image
    console.log('\n🔍 Extracting image URL from the page...');
    const imageData = await page.evaluate(() => {
      const result = { mainImage: null };
      
      // Get all images on the page
      const allImages = Array.from(document.querySelectorAll('img'));
      
      // Find main image (largest/highest resolution)
      const mainImageSelectors = [
        'img[src*="scontent"]',
        'img[src*="fbcdn"]',
        'img[data-imgperflogname]',
        'div[role="img"] img',
        'img[alt*="photo"]'
      ];

      for (const selector of mainImageSelectors) {
        const img = document.querySelector(selector);
        if (img && img.src && img.src.includes('http')) {
          const src = img.src.replace(/&amp;/g, '&');
          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;
          
          // Prefer larger images for main
          if (!result.mainImage || (width * height > (result.mainImage.width * result.mainImage.height || 0))) {
            result.mainImage = {
              url: src,
              width: width,
              height: height
            };
          }
        }
      }

      // Fallback: if no main image found, use largest image
      if (!result.mainImage && allImages.length > 0) {
        const largeImages = allImages
          .filter(img => {
            const width = img.naturalWidth || img.width || 0;
            return width > 200 && img.src && img.src.includes('http');
          })
          .sort((a, b) => {
            const aSize = (a.naturalWidth || a.width || 0) * (a.naturalHeight || a.height || 0);
            const bSize = (b.naturalWidth || b.width || 0) * (b.naturalHeight || b.height || 0);
            return bSize - aSize;
          });

        if (largeImages.length > 0) {
          const img = largeImages[0];
          result.mainImage = {
            url: img.src.replace(/&amp;/g, '&'),
            width: img.naturalWidth || img.width || 0,
            height: img.naturalHeight || img.height || 0
          };
        }
      }

      return result;
    });

    if (imageData.mainImage) {
      console.log('✅ Found main image!');
      console.log('   URL:', imageData.mainImage.url);
      console.log('   Size:', `${imageData.mainImage.width}x${imageData.mainImage.height}px`);
      
      // Download the image
      console.log('\n📥 Downloading image...');
      try {
        const response = await axios({
          method: 'GET',
          url: imageData.mainImage.url,
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': photoUrl
          }
        });

        // Extract filename from URL or use timestamp
        const urlParts = imageData.mainImage.url.split('/');
        let filename = urlParts[urlParts.length - 1].split('?')[0];
        
        // If no extension, try to detect from content-type or default to jpg
        if (!filename || !filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          const ext = imageData.mainImage.url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg';
          filename = `main_${Date.now()}.${ext}`;
        } else {
          // Add prefix to filename
          const ext = filename.split('.').pop();
          const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
          filename = `main_${nameWithoutExt}.${ext}`;
        }
        
        const filepath = path.join(DATA_DIR, filename);

        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on('finish', () => {
            console.log(`✅ Image saved to: ${filepath}`);
            imagePath = filepath;
            resolve(filepath);
          });
          writer.on('error', reject);
        });
      } catch (error) {
        console.error('❌ Error downloading image:', error.message);
        throw error;
      }
    } else {
      console.log('⚠️  Could not find image on the page');
      throw new Error('Could not find image on the page');
    }
    
    return {
      success: true,
      number: extractedNumber,
      imagePath: imagePath,
      imageUrl: imageData.mainImage.url
    };
    
  } catch (error) {
    console.error('⚠️  Error processing photo URL:', error.message);
    throw error;
  }
}

// Function to open Facebook.com and handle login (legacy function - kept for compatibility)
async function openFacebook() {
  let browser;
  try {
    console.log('🌐 Opening Facebook.com...');
    
    // Find system Chrome/Chromium first
    const possiblePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    
    let executablePath = null;
    for (const chromePath of possiblePaths) {
      if (fs.existsSync(chromePath)) {
        executablePath = chromePath;
        break;
      }
    }
    
    const launchOptions = {
      headless: false,
      defaultViewport: { width: 1280, height: 720 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--start-maximized'
      ],
      timeout: 60000,
      slowMo: 100
    };
    
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });
    
    console.log('📄 Navigating to Facebook.com...');
    await page.goto('https://www.facebook.com', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    await delay(3000);
    
    // Check if login screen appears and login if needed
    console.log('🔍 Checking for login screen...');
    try {
      // Find all text inputs on the page
      const textInputs = await page.$$('input[type="text"], input[type="email"], input:not([type])');
      const passwordInputs = await page.$$('input[type="password"]');
      
      console.log(`Found ${textInputs.length} text input(s) and ${passwordInputs.length} password input(s)`);
      
      // Find email input (first text input that's not password)
      let emailField = null;
      let passwordField = null;
      
      // Try multiple selectors for email field
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[id="email"]',
        'input[placeholder*="Email" i]',
        'input[placeholder*="Phone" i]',
        'input[placeholder*="Mobile" i]',
        'input[autocomplete="username"]',
        'input[autocomplete="email"]'
      ];
      
      for (const selector of emailSelectors) {
        emailField = await page.$(selector);
        if (emailField) {
          console.log(`✅ Found email field using selector: ${selector}`);
          break;
        }
      }
      
      // If not found by specific selectors, use first text input
      if (!emailField && textInputs.length > 0) {
        emailField = textInputs[0];
        console.log('✅ Using first text input as email field');
      }
      
      // Find password input
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="pass"]',
        'input[id="pass"]',
        'input[autocomplete="current-password"]'
      ];
      
      for (const selector of passwordSelectors) {
        passwordField = await page.$(selector);
        if (passwordField) {
          console.log(`✅ Found password field using selector: ${selector}`);
          break;
        }
      }
      
      // If not found by specific selectors, use first password input
      if (!passwordField && passwordInputs.length > 0) {
        passwordField = passwordInputs[0];
        console.log('✅ Using first password input');
      }
      
      // Find login button - try multiple strategies
      let loginButton = null;
      
      // Strategy 1: Try common selectors
      const loginButtonSelectors = [
        'button[type="submit"][name="login"]',
        'button[name="login"]',
        'button[id="loginbutton"]',
        'button[id*="login"]',
        'input[type="submit"][name="login"]',
        'input[type="submit"][value*="Log" i]',
        'button[type="submit"]',
        'button[data-testid*="login"]',
        'form button[type="submit"]',
        'form[method="post"] button',
        'button[aria-label*="Log" i]',
        'button[title*="Log" i]'
      ];
      
      for (const selector of loginButtonSelectors) {
        try {
          loginButton = await page.$(selector);
          if (loginButton) {
            console.log(`✅ Found login button using selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Some selectors might not be supported, continue
        }
      }
      
      // Strategy 2: Find button in the same form as email/password fields
      if (!loginButton && emailField) {
        try {
          const form = await emailField.evaluateHandle(el => {
            let current = el;
            while (current && current.tagName !== 'FORM') {
              current = current.parentElement;
            }
            return current;
          });
          
          if (form && form.asElement()) {
            const formButtons = await form.asElement().$$('button[type="submit"], button, input[type="submit"]');
            if (formButtons.length > 0) {
              loginButton = formButtons[0];
              console.log('✅ Found login button in the same form as email field');
            }
          }
        } catch (e) {
          console.log('   Could not find button in form:', e.message);
        }
      }
      
      // Strategy 3: Find by text content using evaluate
      if (!loginButton) {
        const buttonInfo = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
          for (const btn of buttons) {
            const text = (btn.textContent || btn.value || btn.innerText || '').trim();
            const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
            const title = (btn.getAttribute('title') || '').trim();
            
            if (/log\s*in/i.test(text) || /log\s*in/i.test(ariaLabel) || /log\s*in/i.test(title)) {
              // Return selector that can be used to find this button
              if (btn.id) return `#${btn.id}`;
              if (btn.name) return `${btn.tagName.toLowerCase()}[name="${btn.name}"]`;
              if (btn.className && typeof btn.className === 'string') {
                const classes = btn.className.split(' ').filter(c => c && c !== '').slice(0, 3).join('.');
                if (classes) return `${btn.tagName.toLowerCase()}.${classes}`;
              }
              // Return text content as fallback identifier
              return { text: text || ariaLabel || title, tagName: btn.tagName };
            }
          }
          return null;
        });
        
        if (buttonInfo) {
          if (typeof buttonInfo === 'string') {
            loginButton = await page.$(buttonInfo);
            if (loginButton) {
              console.log(`✅ Found login button by text content using selector: ${buttonInfo}`);
            }
          } else {
            // Try to find by tag name and text
            const allButtons = await page.$$(buttonInfo.tagName.toLowerCase());
            for (const btn of allButtons) {
              const text = await page.evaluate(el => {
                return (el.textContent || el.value || el.innerText || el.getAttribute('aria-label') || '').trim();
              }, btn);
              if (/log\s*in/i.test(text)) {
                loginButton = btn;
                console.log(`✅ Found login button by text: "${text}"`);
                break;
              }
            }
          }
        }
      }
      
      // Strategy 4: Find any submit button near the password field
      if (!loginButton && passwordField) {
        try {
          // Get all buttons on the page and find one that's near the password field
          const allButtons = await page.$$('button, input[type="submit"]');
          const passwordBox = await passwordField.boundingBox();
          
          if (passwordBox && allButtons.length > 0) {
            for (const btn of allButtons) {
              const btnBox = await btn.boundingBox();
              if (btnBox) {
                // Check if button is below the password field (within reasonable distance)
                const verticalDistance = btnBox.y - (passwordBox.y + passwordBox.height);
                if (verticalDistance > 0 && verticalDistance < 100) {
                  loginButton = btn;
                  console.log('✅ Found login button near password field');
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.log('   Could not find button by position:', e.message);
        }
      }

      if (emailField && passwordField && loginButton) {
        console.log('🔐 Login screen detected. Attempting to login...');
        
        // Clear and fill email
        await emailField.click({ clickCount: 3 }); // Select all
        await emailField.type('darshana.saluka.pc2@gmail.com', { delay: 50 });
        console.log('✅ Email entered: darshana.saluka.pc2@gmail.com');
        
        // Clear and fill password
        await passwordField.click({ clickCount: 3 }); // Select all
        await passwordField.type('%-3cgA*zirn5G9X', { delay: 50 });
        console.log('✅ Password entered');
        
        await delay(500); // Small delay before clicking
        
        // Click login button - try multiple methods
        try {
          // Method 1: Regular click
          await loginButton.click();
          console.log('✅ Login button clicked');
        } catch (error) {
          // Method 2: Click using JavaScript
          console.log('⚠️  Regular click failed, trying JavaScript click...');
          await loginButton.evaluate((btn) => {
            if (btn.click) {
              btn.click();
            } else if (btn.dispatchEvent) {
              const event = new MouseEvent('click', { bubbles: true, cancelable: true });
              btn.dispatchEvent(event);
            }
          });
          console.log('✅ Login button clicked via JavaScript');
        }
        
        // Also try pressing Enter on the password field as backup
        await delay(300);
        try {
          await passwordField.press('Enter');
          console.log('✅ Also pressed Enter on password field');
        } catch (e) {
          // Enter press is optional, continue anyway
        }
        
        console.log('⏳ Waiting for login to complete...');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await delay(3000);
        
        console.log('✅ Login process completed!');
      } else {
        console.log('ℹ️  Login form not found. Missing elements:');
        if (!emailField) console.log('   - Email field not found');
        if (!passwordField) console.log('   - Password field not found');
        if (!loginButton) console.log('   - Login button not found');
        console.log('ℹ️  Already logged in or page loaded differently.');
      }
    } catch (error) {
      console.log('ℹ️  Login check error:', error.message);
    }
    
    console.log('✅ Facebook.com opened successfully!');
    
    // Navigate to the photo URL
    const photoUrl = 'https://www.facebook.com/photo?fbid=1504359328357097&set=a.502238108569229';
    console.log(`📸 Navigating to photo URL: ${photoUrl}`);
    try {
      await page.goto(photoUrl, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });
      await delay(3000); // Wait for page to fully load
      console.log('✅ Successfully navigated to photo page!');
      
      // Extract the number from the span element
      console.log('🔍 Looking for number in span element...');
      try {
        // Wait a bit for the page to fully render
        await delay(2000);
        
        // Try multiple times with different selectors
        let number = null;
        const selectors = [
          'span.x135b78x',
          'span[class*="x135b78x"]',
          'span[class="x135b78x"]'
        ];
        
        for (const selector of selectors) {
          try {
            number = await page.evaluate((sel) => {
              const span = document.querySelector(sel);
              if (span) {
                const text = span.textContent.trim();
                // Accept text with numbers and letters (like "145K", "1.2K", "1M", etc.)
                // Also accept pure numbers
                if (text && (/^\d+[KMB]?$/i.test(text) || /^\d+\.?\d*[KMB]?$/i.test(text) || /^\d+$/.test(text))) {
                  return text;
                }
              }
              return null;
            }, selector);
            
            if (number) {
              console.log(`✅ Found span element using selector: ${selector}`);
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        
        // Fallback: search all spans with similar class pattern
        if (!number) {
          number = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span[class*="x135"]'));
            for (const s of spans) {
              const text = s.textContent.trim();
              // Accept text with numbers and letters (like "145K", "1.2K", "1M", etc.)
              if (text && (/^\d+[KMB]?$/i.test(text) || /^\d+\.?\d*[KMB]?$/i.test(text) || /^\d+$/.test(text))) {
                return text;
              }
            }
            return null;
          });
        }
        
        // Additional fallback: try to find the nested structure
        if (!number) {
          number = await page.evaluate(() => {
            // Look for the nested structure: span > span > span.x135b78x
            const parentSpans = Array.from(document.querySelectorAll('span[aria-hidden="true"]'));
            for (const parentSpan of parentSpans) {
              const nestedSpan = parentSpan.querySelector('span span.x135b78x');
              if (nestedSpan) {
                const text = nestedSpan.textContent.trim();
                if (text && (/^\d+[KMB]?$/i.test(text) || /^\d+\.?\d*[KMB]?$/i.test(text) || /^\d+$/.test(text))) {
                  return text;
                }
              }
            }
            return null;
          });
        }
        
        if (number) {
          console.log(`\n${'='.repeat(50)}`);
          console.log(`📊 NUMBER FOUND: ${number}`);
          console.log(`${'='.repeat(50)}\n`);
        } else {
          console.log('⚠️  Could not find the number in span element');
          // Debug: print all spans with similar classes
          const debugInfo = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span[class*="x135"]'));
            return spans.map(s => ({
              class: s.className,
              text: s.textContent.trim()
            })).slice(0, 10);
          });
          console.log('Debug - Found spans:', debugInfo);
        }
      } catch (error) {
        console.error('⚠️  Error extracting number:', error.message);
      }
      
      // Extract and download the image
      console.log('\n🔍 Extracting image URL from the page...');
      const imageData = await page.evaluate(() => {
        const result = { mainImage: null };
        
        // Get all images on the page
        const allImages = Array.from(document.querySelectorAll('img'));
        
        // Find main image (largest/highest resolution)
        const mainImageSelectors = [
          'img[src*="scontent"]',
          'img[src*="fbcdn"]',
          'img[data-imgperflogname]',
          'div[role="img"] img',
          'img[alt*="photo"]'
        ];

        for (const selector of mainImageSelectors) {
          const img = document.querySelector(selector);
          if (img && img.src && img.src.includes('http')) {
            const src = img.src.replace(/&amp;/g, '&');
            const width = img.naturalWidth || img.width || 0;
            const height = img.naturalHeight || img.height || 0;
            
            // Prefer larger images for main
            if (!result.mainImage || (width * height > (result.mainImage.width * result.mainImage.height || 0))) {
              result.mainImage = {
                url: src,
                width: width,
                height: height
              };
            }
          }
        }

        // Fallback: if no main image found, use largest image
        if (!result.mainImage && allImages.length > 0) {
          const largeImages = allImages
            .filter(img => {
              const width = img.naturalWidth || img.width || 0;
              return width > 200 && img.src && img.src.includes('http');
            })
            .sort((a, b) => {
              const aSize = (a.naturalWidth || a.width || 0) * (a.naturalHeight || a.height || 0);
              const bSize = (b.naturalWidth || b.width || 0) * (b.naturalHeight || b.height || 0);
              return bSize - aSize;
            });

          if (largeImages.length > 0) {
            const img = largeImages[0];
            result.mainImage = {
              url: img.src.replace(/&amp;/g, '&'),
              width: img.naturalWidth || img.width || 0,
              height: img.naturalHeight || img.height || 0
            };
          }
        }

        return result;
      });

      if (imageData.mainImage) {
        console.log('✅ Found main image!');
        console.log('   URL:', imageData.mainImage.url);
        console.log('   Size:', `${imageData.mainImage.width}x${imageData.mainImage.height}px`);
        
        // Download the image
        console.log('\n📥 Downloading image...');
        try {
          const response = await axios({
            method: 'GET',
            url: imageData.mainImage.url,
            responseType: 'stream',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': photoUrl
            }
          });

          // Extract filename from URL or use timestamp
          const urlParts = imageData.mainImage.url.split('/');
          let filename = urlParts[urlParts.length - 1].split('?')[0];
          
          // If no extension, try to detect from content-type or default to jpg
          if (!filename || !filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
            const ext = imageData.mainImage.url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg';
            filename = `main_${Date.now()}.${ext}`;
          } else {
            // Add prefix to filename
            const ext = filename.split('.').pop();
            const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
            filename = `main_${nameWithoutExt}.${ext}`;
          }
          
          const filepath = path.join(DATA_DIR, filename);

          const writer = fs.createWriteStream(filepath);
          response.data.pipe(writer);

          await new Promise((resolve, reject) => {
            writer.on('finish', () => {
              console.log(`✅ Image saved to: ${filepath}`);
              resolve(filepath);
            });
            writer.on('error', reject);
          });
        } catch (error) {
          console.error('❌ Error downloading image:', error.message);
        }
      } else {
        console.log('⚠️  Could not find image on the page');
      }
      
    } catch (error) {
      console.error('⚠️  Error navigating to photo URL:', error.message);
    }
    
    // Close the browser after all tasks are completed
    console.log('\n🔒 Closing browser...');
    try {
      await browser.close();
      console.log('✅ Browser closed successfully');
    } catch (error) {
      console.error('⚠️  Error closing browser:', error.message);
    }
    
    return { success: true, message: 'Facebook.com opened, data collected, image downloaded, and browser closed' };
    
  } catch (error) {
    console.error('❌ Error opening Facebook.com:', error.message);
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}

// Helper function to parse JSON from request body
function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// Helper function to send JSON response
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

// Helper function to send HTML file
function sendHTML(res, statusCode, filePath) {
  try {
    const htmlContent = fs.readFileSync(filePath, 'utf8');
    res.writeHead(statusCode, { 'Content-Type': 'text/html' });
    res.end(htmlContent);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
  }
}

// Helper function to send image file
function sendImage(res, filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Image not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };

    const contentType = contentTypes[ext] || 'image/jpeg';
    const imageData = fs.readFileSync(filePath);

    res.writeHead(200, { 
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600'
    });
    res.end(imageData);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error reading image');
  }
}

// Create the server
const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const urlPath = parsedUrl.pathname;

  try {
    // Serve HTML frontend at /api
    if (urlPath === '/api' || urlPath === '/API') {
      const htmlPath = path.join(__dirname, 'frontend', 'index.html');
      sendHTML(res, 200, htmlPath);
      return;
    }

    // Serve images from data folder
    if (urlPath.startsWith('/data/') && req.method === 'GET') {
      const filename = urlPath.replace('/data/', '').split('?')[0]; // Remove query params
      // Security: prevent directory traversal
      if (filename.includes('..') || filename.startsWith('/')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid filename');
        return;
      }
      const imagePath = path.join(process.cwd(), DATA_DIR, filename);
      sendImage(res, imagePath);
      return;
    }

    // Health check endpoint
    if (urlPath === '/' && req.method === 'GET') {
      sendJSON(res, 200, {
        message: 'Facebook Image Downloader Server',
        status: 'running',
        facebookLogin: globalBrowser && globalPage ? 'ready' : 'not_ready',
        endpoints: {
          health: 'GET /',
          status: 'GET /status',
          frontend: 'GET /api',
          openFacebook: 'GET /open-facebook',
          processPhoto: 'POST /process-photo',
          download: 'POST /download'
        }
      });
      return;
    }

    // Status endpoint - check if Facebook login is ready
    if (urlPath === '/status' && req.method === 'GET') {
      const isReady = globalBrowser && globalPage;
      sendJSON(res, 200, {
        success: true,
        facebookLogin: isReady ? 'ready' : 'not_ready',
        message: isReady ? 'Facebook login completed. Server is ready to process photos.' : 'Facebook login not completed yet. Please wait...',
        ready: isReady
      });
      return;
    }

    // Open Facebook.com endpoint
    if (urlPath === '/open-facebook' && req.method === 'GET') {
      console.log('📥 Open Facebook request received');
      
      try {
        const result = await openFacebook();
        sendJSON(res, 200, {
          success: true,
          message: 'Facebook.com opened successfully',
          data: { browserOpen: true }
        });
      } catch (error) {
        sendJSON(res, 500, {
          success: false,
          error: error.message
        });
      }
      return;
    }

    // Process Facebook photo URL - extract number and download image
    if (urlPath === '/process-photo' && req.method === 'POST') {
      const body = await parseJSONBody(req);
      const { url: photoUrl } = body;

      if (!photoUrl) {
        sendJSON(res, 400, {
          error: 'URL is required',
          example: { url: 'https://www.facebook.com/photo?fbid=...' }
        });
        return;
      }

      console.log(`📥 Process photo request received for: ${photoUrl}`);

      try {
        const result = await processPhotoUrl(photoUrl);
        
        // Create viewable image URL
        let viewableImageUrl = null;
        if (result.imagePath) {
          const filename = path.basename(result.imagePath);
          // Get the host from the request
          const host = req.headers.host || 'localhost:4561';
          viewableImageUrl = `http://${host}/data/${filename}`;
        }
        
        sendJSON(res, 200, {
          success: true,
          message: 'Photo processed successfully',
          data: {
            number: result.number,
            imagePath: result.imagePath,
            imageUrl: result.imageUrl,
            viewableImageUrl: viewableImageUrl
          }
        });
      } catch (error) {
        sendJSON(res, 500, {
          success: false,
          error: error.message
        });
      }
      return;
    }

    // Download Facebook image endpoint
    if (urlPath === '/download' && req.method === 'POST') {
      const body = await parseJSONBody(req);
      const { url: imageUrl } = body;

      if (!imageUrl) {
        sendJSON(res, 400, {
          error: 'URL is required',
          example: { url: 'https://www.facebook.com/photo?fbid=...' }
        });
        return;
      }

      console.log(`📥 Download request received for: ${imageUrl}`);

      // Download the image
      const result = await downloadFacebookImage(imageUrl);

      sendJSON(res, 200, {
        success: true,
        message: 'Image downloaded successfully',
        data: result
      });
      return;
    }

    // 404 for unknown routes
    sendJSON(res, 404, {
      error: 'Not Found',
      message: `Route ${req.method} ${urlPath} not found`
    });

  } catch (error) {
    console.error('❌ Error processing request:', error.message);
    sendJSON(res, 500, {
      success: false,
      error: error.message
    });
  }
});

// Start the server
server.listen(PORT, async () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   GET  / - Health check`);
  console.log(`   GET  /api - Frontend HTML page`);
  console.log(`   GET  /open-facebook - Open Facebook.com`);
  console.log(`   POST /process-photo - Process Facebook photo (extract number & download image)`);
  console.log(`   POST /download - Download Facebook image`);
  
  // Automatically login to Facebook when server starts
  console.log('\n🌐 Logging into Facebook automatically on server start...');
  try {
    await loginToFacebook();
    console.log('✅ Facebook login completed! Browser is ready for use.');
  } catch (error) {
    console.error('⚠️  Failed to login to Facebook automatically:', error.message);
    console.log('💡 You can manually login by calling GET /open-facebook');
  }
});

