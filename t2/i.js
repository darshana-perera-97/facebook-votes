const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DEFAULT_FACEBOOK_URL = 'https://www.facebook.com/photo?fbid=1504359328357097&set=a.502238108569229';
const DATA_DIR = './data';

// Helper function to wait/delay (replacement for page.waitForTimeout)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function downloadFacebookImage(url = DEFAULT_FACEBOOK_URL) {
  let browser;
  try {
    console.log('Launching browser...');
    
    // Find system Chrome/Chromium first (more reliable)
    const possiblePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    
    let executablePath = null;
    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        executablePath = path;
        console.log(`Using system browser: ${path}`);
        break;
      }
    }
    
    const launchOptions = {
      headless: false, // Show the browser window
      defaultViewport: { width: 1280, height: 720 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--start-maximized'
      ],
      timeout: 60000,
      slowMo: 100 // Slow down operations by 100ms so you can see what's happening
    };
    
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    
    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set viewport size
    await page.setViewport({ width: 1280, height: 720 });
    
    console.log('🌐 Opening browser window...');
    console.log('📄 Navigating to Facebook page:', url);
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    console.log('⏳ Waiting for page to fully load...');
    // Wait a bit for the page to fully render
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
        
        // Wait for navigation after login
        console.log('⏳ Waiting for login to complete...');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await delay(3000); // Additional wait for page to fully load
        
        console.log('✅ Login process completed!');
      } else {
        console.log('ℹ️  Login form not found. Missing elements:');
        if (!emailField) console.log('   - Email field not found');
        if (!passwordField) console.log('   - Password field not found');
        if (!loginButton) console.log('   - Login button not found');
        console.log('ℹ️  Already logged in or page loaded differently. Continuing...');
      }
    } catch (error) {
      // If login elements not found or login fails, continue anyway
      console.log('ℹ️  Login screen not found or already logged in. Continuing...');
    }
    
    console.log('✅ Page loaded! Looking for images...');

    console.log('🔍 Extracting image URLs from the page...');
    
    // Extract both main image and preview
    const imageData = await page.evaluate(() => {
      const result = { mainImage: null, previewImage: null };
      
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

      // Find preview/thumbnail (smaller images, often in sidebar or thumbnails)
      const previewImages = allImages.filter(img => {
        if (!img.src || !img.src.includes('http')) return false;
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        // Preview images are typically smaller (less than 500px width)
        return width > 50 && width < 500 && height > 50 && height < 500;
      });

      // Also look for specific preview/thumbnail selectors
      const previewSelectors = [
        'img[src*="thumbnail"]',
        'img[src*="preview"]',
        'img[src*="thumb"]',
        'a[role="link"] img',
        '[data-testid*="photo"] img'
      ];

      for (const selector of previewSelectors) {
        const img = document.querySelector(selector);
        if (img && img.src && img.src.includes('http')) {
          const src = img.src.replace(/&amp;/g, '&');
          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;
          
          if (width > 50 && width < 1000) {
            previewImages.push({
              src: src,
              width: width,
              height: height
            });
          }
        }
      }

      // Get the best preview image (largest among small images)
      if (previewImages.length > 0) {
        previewImages.sort((a, b) => {
          const aSize = (a.naturalWidth || a.width || 0) * (a.naturalHeight || a.height || 0);
          const bSize = (b.naturalWidth || b.width || 0) * (b.naturalHeight || b.height || 0);
          return bSize - aSize;
        });
        
        const bestPreview = previewImages[0];
        result.previewImage = {
          url: bestPreview.src || bestPreview,
          width: bestPreview.naturalWidth || bestPreview.width || 0,
          height: bestPreview.naturalHeight || bestPreview.height || 0
        };
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

    if (!imageData.mainImage) {
      throw new Error('Could not find main image URL on the page');
    }

    console.log('✅ Found main image!');
    console.log('   URL:', imageData.mainImage.url);
    console.log('   Size:', `${imageData.mainImage.width}x${imageData.mainImage.height}px`);
    
    if (imageData.previewImage) {
      console.log('✅ Found preview image!');
      console.log('   URL:', imageData.previewImage.url);
      console.log('   Size:', `${imageData.previewImage.width}x${imageData.previewImage.height}px`);
    } else {
      console.log('ℹ️  No separate preview image found (using main image only)');
    }
    
    // Keep browser open for a moment so user can see the page
    console.log('👀 Browser window will stay open for 5 seconds so you can see the page...');
    await delay(5000);

    // Helper function to download an image
    const downloadImage = async (imageUrl, prefix = 'main') => {
      console.log(`\n📥 Downloading ${prefix} image...`);
      const response = await axios({
        method: 'GET',
        url: imageUrl,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': url
        }
      });

      // Extract filename from URL or use timestamp
      const urlParts = imageUrl.split('/');
      let filename = urlParts[urlParts.length - 1].split('?')[0];
      
      // If no extension, try to detect from content-type or default to jpg
      if (!filename || !filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        const ext = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg';
        filename = `${prefix}_${Date.now()}.${ext}`;
      } else {
        // Add prefix to filename
        const ext = filename.split('.').pop();
        const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
        filename = `${prefix}_${nameWithoutExt}.${ext}`;
      }
      
      const filepath = path.join(DATA_DIR, filename);

      const writer = fs.createWriteStream(filepath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`✅ ${prefix.charAt(0).toUpperCase() + prefix.slice(1)} image saved to: ${filepath}`);
          resolve(filepath);
        });
        writer.on('error', reject);
      });
    };

    // Download main image
    const mainImagePath = await downloadImage(imageData.mainImage.url, 'main');
    
    // Download preview image if found
    let previewImagePath = null;
    if (imageData.previewImage && imageData.previewImage.url !== imageData.mainImage.url) {
      try {
        previewImagePath = await downloadImage(imageData.previewImage.url, 'preview');
      } catch (error) {
        console.warn('Failed to download preview image:', error.message);
      }
    }

    return {
      mainImage: mainImagePath,
      previewImage: previewImagePath
    };

  } catch (error) {
    console.error('Error downloading image:', error.message);
    if (error.message.includes('Chromium not found') || error.message.includes('Timeout')) {
      console.error('\nTroubleshooting tips:');
      console.error('1. Install Chromium: sudo apt-get install chromium-browser');
      console.error('2. Or install Chromium dependencies: sudo apt-get install -y chromium-browser chromium-chromedriver');
      console.error('3. Make sure you have enough disk space and memory');
    }
    throw error;
  } finally {
    if (browser) {
      console.log('\n🔒 Closing browser...');
      await browser.close();
      console.log('✅ Browser closed.');
    }
  }
}

// Export function for use in server
module.exports = { downloadFacebookImage };

// Run the download if called directly
if (require.main === module) {
  downloadFacebookImage()
    .then((result) => {
      console.log('\nSuccess! Images downloaded:');
      console.log('Main image:', result.mainImage);
      if (result.previewImage) {
        console.log('Preview image:', result.previewImage);
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to download image:', error);
      process.exit(1);
    });
}
