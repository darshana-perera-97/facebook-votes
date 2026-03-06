const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 4041;
const DATA_DIR = path.join(__dirname, 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const FRONTEND_BUILD = path.join(__dirname, '..', 'frontend', 'build');

app.use(cors());
app.use(express.json());

// Serve static files from the React app
app.use(express.static(FRONTEND_BUILD));

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fsPromises.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Initialize posts.json if it doesn't exist
async function initializePostsFile() {
  try {
    await fsPromises.access(POSTS_FILE);
  } catch (error) {
    // File doesn't exist, create it with empty array
    await fsPromises.writeFile(POSTS_FILE, JSON.stringify([], null, 2));
  }
}

// Read posts from file
async function readPosts() {
  try {
    const data = await fsPromises.readFile(POSTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading posts:', error);
    return [];
  }
}

// Write posts to file
async function writePosts(posts) {
  try {
    await fsPromises.writeFile(POSTS_FILE, JSON.stringify(posts, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing posts:', error);
    return false;
  }
}

// Check if Playwright browsers are installed
async function checkPlaywrightBrowsers() {
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
  const page = await browser.newPage();
    await page.goto('https://example.com', { waitUntil: 'load', timeout: 10000 });
    await browser.close();
    console.log('✅ Playwright browsers are installed and working');
    return true;
  } catch (error) {
    if (error.message.includes('Executable doesn\'t exist') || error.message.includes('browserType.launch')) {
      console.error('❌ Playwright browsers are not installed!');
      console.error('Please run: npx playwright install chromium');
      console.error('Or install all browsers: npx playwright install');
      return false;
    } else if (error.message.includes('libnss') || error.message.includes('libatk') || error.message.includes('lib')) {
      console.error('❌ Missing system dependencies!');
      console.error('On Ubuntu/Debian, run: npx playwright install-deps chromium');
      console.error('Or manually: sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2');
      return false;
    } else {
      console.error('❌ Browser check failed:', error.message);
      console.error('Run: npm run check-deps to diagnose the issue');
      return false;
    }
  }
}

// Initialize on startup
async function initialize() {
  await ensureDataDir();
  await initializePostsFile();
  console.log('Data directory initialized');
  
  // Check Playwright browsers
  const browsersInstalled = await checkPlaywrightBrowsers();
  if (!browsersInstalled) {
    console.warn('⚠️  Warning: Playwright browsers not installed. Scraping will fail until browsers are installed.');
  }
}

// Helper function to close login popup
async function closeLoginPopup(page) {
  const closeButtonSelectors = [
    'div[role="dialog"] button[aria-label="Close"]',
    'div[role="dialog"] button[aria-label*="Close"]',
    'div[role="dialog"] span[aria-label="Close"]',
    'div[aria-label="Close"]',
    'button[aria-label="Close"]',
    'div[role="dialog"] div[aria-label="Close"]',
    'div[role="dialog"] [aria-label*="close" i]',
    'div[role="dialog"] button:has-text("Not Now")',
    'div[role="dialog"] button:has-text("Close")',
    'div[role="dialog"] button:has-text("✕")',
    'div[role="dialog"] button:has-text("×")',
    '[data-testid="close-button"]',
    'div[role="dialog"] > div > div > div > div > div > div > button',
    'div[role="dialog"] button[type="button"]:last-child',
  ];

  let popupClosed = false;
  for (const selector of closeButtonSelectors) {
    try {
      const closeButton = await page.$(selector);
      if (closeButton) {
        const isVisible = await closeButton.isVisible();
        if (isVisible) {
          await closeButton.click();
          await page.waitForTimeout(1000);
          popupClosed = true;
          break;
        }
      }
    } catch (e) {
      continue;
    }
  }

  // Try Escape key
  if (!popupClosed) {
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    } catch (e) {
      // Ignore
    }
  }

  // Try clicking backdrop
  if (!popupClosed) {
    try {
      const backdrop = await page.$('div[role="dialog"]');
      if (backdrop) {
        await backdrop.click({ position: { x: 10, y: 10 } });
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      // Ignore
    }
  }
}

// Helper function to extract image URL
async function extractImageUrl(page) {
  let imageUrl = null;
  const currentUrl = page.url();
  const isMbasic = currentUrl.includes('mbasic.facebook.com');
  
  // Different selectors for mbasic vs web.facebook.com
  const imageSelectors = isMbasic ? [
    'img[src*="scontent"]',
    'img[src*="fbcdn"]',
    'a[href*="/photo"] img',
    'div[data-ft] img',
    'table img[src*="scontent"]',
    'img[src*="cdn"]',
  ] : [
    'img[src*="scontent"]',
    'img[alt*="photo"]',
    'div[role="img"] img',
    'img[data-imgperflogname]',
    'img[src*="fbcdn"]',
    'img[src*="facebook"]',
    'img[src*="cdn"]',
  ];

  // Try selectors first
  for (const selector of imageSelectors) {
    try {
      const images = await page.$$(selector);
      for (const img of images) {
        const src = await img.getAttribute('src');
        if (src && (src.includes('scontent') || src.includes('fbcdn') || src.includes('facebook') || src.includes('cdn'))) {
          // Check if it's a valid image URL (not a data URI or placeholder)
          if (!src.startsWith('data:') && !src.includes('placeholder') && !src.includes('icon') && src.length > 20) {
            // For mbasic, prefer larger images
            if (isMbasic) {
              try {
                const width = await img.evaluate(el => el.naturalWidth || el.width || 0);
                const height = await img.evaluate(el => el.naturalHeight || el.height || 0);
                if (width > 200 && height > 200) {
                  imageUrl = src;
                  break;
                }
              } catch (e) {
                // If we can't check size, use it anyway
                imageUrl = src;
                break;
              }
            } else {
              imageUrl = src;
              break;
            }
          }
        }
      }
      if (imageUrl) break;
    } catch (e) {
      continue;
    }
  }
  
  // Try to get all images and find the largest one (likely the main post image)
  if (!imageUrl) {
    try {
      const allImages = await page.$$('img');
      let largestImage = null;
      let largestSize = 0;
      
      for (const img of allImages) {
        try {
          const src = await img.getAttribute('src');
          if (src && (src.includes('scontent') || src.includes('fbcdn') || src.includes('cdn')) && !src.startsWith('data:') && !src.includes('icon')) {
            const naturalWidth = await img.evaluate(el => el.naturalWidth || el.width || 0);
            const naturalHeight = await img.evaluate(el => el.naturalHeight || el.height || 0);
            const size = naturalWidth * naturalHeight;
            
            if (size > largestSize && size > 10000) { // Only consider images larger than 100x100
              largestSize = size;
              largestImage = src;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (largestImage) {
        imageUrl = largestImage;
      }
    } catch (e) {
      // Ignore
    }
  }
  
  // For mbasic, try to find image in photo link
  if (!imageUrl && isMbasic) {
    try {
      const photoLink = await page.$('a[href*="/photo"]');
      if (photoLink) {
        const img = await photoLink.$('img');
        if (img) {
          const src = await img.getAttribute('src');
          if (src && (src.includes('scontent') || src.includes('fbcdn')) && !src.startsWith('data:')) {
            imageUrl = src;
          }
        }
      }
    } catch (e) {
      // Ignore
    }
  }
  
  // Final fallback: try to get currentSrc (loaded image)
  if (!imageUrl) {
    try {
      const mainImage = await page.$('img[src*="scontent"], img[src*="fbcdn"]');
      if (mainImage) {
        imageUrl = await mainImage.evaluate(el => el.currentSrc || el.src);
      }
    } catch (e) {
      // Ignore
    }
  }
  
  return imageUrl;
}

// Helper function to extract likes count from x135b78x class
async function extractLikesCount(page) {
  let likesCount = null;
  let numbers = [];
  const currentUrl = page.url();
  const isMbasic = currentUrl.includes('mbasic.facebook.com');

  // For mbasic.facebook.com, use different approach
  if (isMbasic) {
    try {
      // Try to find reactions text in mbasic format
      const pageContent = await page.textContent('body');
      
      // Look for patterns like "123 people like this" or "123 reactions"
      const patterns = [
        /(\d+[\d,]*)\s+people\s+like/i,
        /(\d+[\d,]*)\s+reactions?/i,
        /(\d+[\d,]*)\s+likes?/i,
        /(\d+[\d,]*)\s+people/i,
      ];
      
      for (const pattern of patterns) {
        const match = pageContent.match(pattern);
        if (match) {
          likesCount = parseInt(match[1].replace(/,/g, ''), 10);
          if (likesCount > 0) break;
        }
      }
      
      // Also try to find in specific elements
      if (!likesCount) {
        try {
          const reactionLinks = await page.$$('a[href*="reactions"]');
          for (const el of reactionLinks) {
            const text = await el.textContent();
            const match = text.match(/(\d+[\d,]*)/);
            if (match) {
              const num = parseInt(match[1].replace(/,/g, ''), 10);
              if (num > (likesCount || 0)) {
                likesCount = num;
              }
            }
          }
          
          // Try to find spans with like/reaction text
          const allSpans = await page.$$('span');
          for (const el of allSpans) {
            const text = await el.textContent();
            if (text && (text.toLowerCase().includes('like') || text.toLowerCase().includes('reaction'))) {
              const match = text.match(/(\d+[\d,]*)/);
              if (match) {
                const num = parseInt(match[1].replace(/,/g, ''), 10);
                if (num > (likesCount || 0)) {
                  likesCount = num;
                }
              }
            }
          }
        } catch (e) {
          // Ignore
        }
      }
    } catch (e) {
      console.log(`mbasic extraction failed: ${e.message}`);
    }
  } else {
    // For web.facebook.com, use original method
    try {
      // Try to wait for the selector, but don't fail if it doesn't appear
      await page.waitForSelector('.x135b78x', { timeout: 15000 }).catch(() => {
        console.log('x135b78x selector not found, trying alternative methods...');
      });
      const elements = await page.$$('.x135b78x');

      for (const element of elements) {
        const text = await element.textContent();
        if (text && text.trim()) {
          const numberMatches = text.match(/[\d,]+/g);
          if (numberMatches) {
            numberMatches.forEach(match => {
              const num = parseInt(match.replace(/,/g, ''), 10);
              if (!isNaN(num) && num > 0) {
                numbers.push(num);
              }
            });
          }
        }
      }

      // Use the largest number as likes count
      if (numbers.length > 0) {
        likesCount = Math.max(...numbers);
      }
    } catch (e) {
      console.log(`Could not find x135b78x elements: ${e.message}`);
    }
  }

  // Fallback: Try to find reactions in other ways (works for both)
  if (!likesCount) {
    try {
      const pageContent = await page.textContent('body');
      const reactionMatch = pageContent.match(/(\d+[\d,]*)\s*(reactions?|likes?|people)/i);
      if (reactionMatch) {
        likesCount = parseInt(reactionMatch[1].replace(/,/g, ''), 10);
      }
    } catch (e) {
      // Ignore
    }
  }

  return likesCount || 0;
}

// API endpoint to scrape Facebook post
app.post('/api/scrape-post', async (req, res) => {
  const { postUrl } = req.body;

  if (!postUrl) {
    return res.status(400).json({ success: false, error: 'Post URL is required' });
  }

  // Log timestamp when scraping starts
  const timestamp = new Date().toLocaleString('en-US', { 
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  console.log(`\n[${timestamp}] 🔄 Rescraping cycle started for: ${postUrl}`);

  let browser;
  let context;
  try {
    // Linux server configuration for headless Chrome
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-features=TranslateUI',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--safebrowsing-disable-auto-update',
        '--enable-automation',
        '--password-store=basic',
        '--use-mock-keychain',
      ],
    };

    browser = await chromium.launch(launchOptions);
    console.log(`[${timestamp}] 🌐 Browser launched successfully`);
  } catch (error) {
    if (error.message.includes('Executable doesn\'t exist') || error.message.includes('browserType.launch')) {
      const errorTime = new Date().toLocaleString('en-US', { 
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      console.error(`[${errorTime}] ❌ Playwright browsers not installed!`);
      console.error(`[${errorTime}] Run: npx playwright install chromium`);
      return res.status(500).json({
        success: false,
        error: 'Playwright browsers are not installed. Please run: npx playwright install chromium',
      });
    }
    console.error(`[${timestamp}] ❌ Browser launch error:`, error.message);
    throw error;
  }
  
  // Set realistic user agent to avoid detection
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  // Create browser context with user agent and viewport
  context = await browser.newContext({
    userAgent: randomUserAgent,
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
    },
  });
  
  const page = await context.newPage();
  
  // Set longer timeout for navigation
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);

  try {
    console.log(`[${timestamp}] 📥 Navigating to post...`);
    
    // Try mbasic.facebook.com first (lighter version, less blocking)
    let actualPostUrl = postUrl;
    if (postUrl.includes('web.facebook.com')) {
      actualPostUrl = postUrl.replace('web.facebook.com', 'mbasic.facebook.com');
      console.log(`[${timestamp}] 🔄 Trying mbasic.facebook.com (lighter version)...`);
    }
    
    // Use 'load' instead of 'networkidle' as it's more reliable
    // 'networkidle' can timeout if page has continuous network activity
    let navigationSuccess = false;
    try {
      await page.goto(actualPostUrl, { waitUntil: 'load', timeout: 60000 });
      console.log(`[${timestamp}] ✅ Page loaded successfully`);
      
      // Wait a bit for content
      await page.waitForTimeout(2000);
      
      // Check if we're blocked or redirected to login
      const currentUrl = page.url();
      const pageContent = await page.textContent('body').catch(() => '');
      const pageTitle = await page.title().catch(() => '');
      
      const isBlocked = currentUrl.includes('login') || 
                       currentUrl.includes('checkpoint') || 
                       currentUrl.includes('facebook.com/login') ||
                       pageContent.toLowerCase().includes('log into facebook') ||
                       pageContent.toLowerCase().includes('log in') ||
                       pageContent.toLowerCase().includes('create new account') ||
                       pageTitle.toLowerCase().includes('log in');
      
      if (isBlocked) {
        console.log(`[${timestamp}] ⚠️ Facebook is requiring login or blocking access`);
        console.log(`[${timestamp}] Current URL: ${currentUrl}`);
        
        // Try original URL if we used mbasic
        if (actualPostUrl !== postUrl) {
          console.log(`[${timestamp}] 🔄 Trying original web.facebook.com URL...`);
          await page.goto(postUrl, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(2000);
          
          const retryUrl = page.url();
          const retryContent = await page.textContent('body').catch(() => '');
          if (retryUrl.includes('login') || retryContent.toLowerCase().includes('log into facebook')) {
            throw new Error('Facebook is blocking access or requiring login. The page may be private, require authentication, or your server IP may be rate-limited.');
          }
          navigationSuccess = true;
        } else {
          throw new Error('Facebook is blocking access or requiring login. The page may be private or require authentication.');
        }
      } else {
        navigationSuccess = true;
      }
      
    } catch (navError) {
      console.error(`[${timestamp}] ⚠️ Navigation error:`, navError.message);
      
      // Check if it's a blocking/restriction error
      if (navError.message.includes('net::ERR') || navError.message.includes('blocked') || navError.message.includes('Facebook')) {
        throw navError;
      }
      
      // Try with domcontentloaded as fallback
      if (!navigationSuccess) {
        try {
          console.log(`[${timestamp}] 🔄 Trying with domcontentloaded fallback...`);
          await page.goto(actualPostUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(2000);
          console.log(`[${timestamp}] ✅ Page loaded with domcontentloaded`);
          
          // Check again for login/block
          const currentUrl = page.url();
          const pageContent = await page.textContent('body').catch(() => '');
          if (currentUrl.includes('login') || pageContent.toLowerCase().includes('log into facebook')) {
            throw new Error('Facebook is requiring login or blocking access.');
          }
          navigationSuccess = true;
        } catch (fallbackError) {
          if (fallbackError.message.includes('Facebook')) {
            throw fallbackError;
          }
          throw new Error(`Failed to load page: ${fallbackError.message}`);
        }
      }
    }
    
    // Final check - verify we're not on a blocked/restricted page before proceeding
    const finalUrl = page.url();
    const finalText = await page.textContent('body').catch(() => '');
    const finalTitle = await page.title().catch(() => '');
    
    if (finalUrl.includes('login') || finalUrl.includes('checkpoint') || 
        finalText.toLowerCase().includes('log into facebook') ||
        finalText.toLowerCase().includes('create new account') ||
        finalTitle.toLowerCase().includes('log in')) {
      await context.close();
      await browser.close();
      throw new Error('Access blocked: Facebook is requiring login or blocking automated access. The post may be private, require authentication, or your server IP may be rate-limited. Try using a VPN or different server IP.');
    }

    await page.waitForTimeout(3000);

    // Close login popup if present (but we're not on login page)
    await closeLoginPopup(page);
    await page.waitForTimeout(3000);
    
    // Wait for content to be ready
    try {
      await page.waitForSelector('body', { timeout: 10000 });
    } catch (e) {
      console.log(`[${timestamp}] ⚠️ Body selector not found, continuing anyway...`);
    }

    // Extract data
    console.log(`[${timestamp}] 🔍 Extracting image and likes count...`);
    console.log(`[${timestamp}] 📍 Current URL: ${page.url()}`);
    
    // Wait a bit more for images to fully load
    await page.waitForTimeout(3000);
    
    // Scroll down a bit to trigger lazy loading
    await page.evaluate(() => {
      window.scrollBy(0, 500);
    });
    await page.waitForTimeout(1000);
    
    let imageUrl = await extractImageUrl(page);
    const likesCount = await extractLikesCount(page);
    
    console.log(`[${timestamp}] 📊 Extraction results - Image: ${imageUrl ? 'Found' : 'Not found'}, Likes: ${likesCount}`);
    
    // If no image found, try finding image in post element
    if (!imageUrl) {
      try {
        console.log(`[${timestamp}] 📸 No image URL found, trying alternative extraction...`);
        const postElement = await page.$('div[role="article"]') || await page.$('div[data-pagelet]');
        if (postElement) {
          const postImage = await postElement.$('img[src*="scontent"], img[src*="fbcdn"]');
          if (postImage) {
            imageUrl = await postImage.getAttribute('src');
            console.log(`[${timestamp}] ✅ Found image in post element`);
          }
        }
      } catch (e) {
        console.log(`[${timestamp}] ⚠️ Alternative extraction failed: ${e.message}`);
      }
    }

    await context.close();
    await browser.close();

    const endTime = new Date().toLocaleString('en-US', { 
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    if (imageUrl) {
      // Show truncated URL for readability
      const shortUrl = imageUrl.length > 80 ? imageUrl.substring(0, 80) + '...' : imageUrl;
      console.log(`[${endTime}] ✅ Scraping completed - Likes: ${likesCount}`);
      console.log(`[${endTime}] 🖼️  Image URL: ${shortUrl}`);
    } else {
      console.log(`[${endTime}] ✅ Scraping completed - Likes: ${likesCount}, Image: ❌ Not found`);
    }

    res.json({
      success: true,
      data: {
        postUrl,
        imageUrl: imageUrl || null,
        likesCount: likesCount || 0,
      },
    });
  } catch (error) {
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
  await browser.close();
    }
    const errorTime = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    // Provide more helpful error messages
    let errorMessage = error.message;
    if (error.message.includes('Timeout')) {
      errorMessage = 'Page load timeout. Facebook may be slow or the page structure has changed.';
    } else if (error.message.includes('net::ERR')) {
      errorMessage = 'Network error. Please check your internet connection.';
    }
    
    console.error(`[${errorTime}] ❌ Error scraping post:`, errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Image proxy endpoint to handle CORS and expired URLs
app.get('/api/image-proxy', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Image URL is required' });
  }

  try {
    const imageUrl = decodeURIComponent(url);
    const protocol = imageUrl.startsWith('https') ? https : http;
    
    protocol.get(imageUrl, (imageResponse) => {
      if (imageResponse.statusCode !== 200) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Set appropriate headers
      res.setHeader('Content-Type', imageResponse.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Pipe the image data to response
      imageResponse.pipe(res);
    }).on('error', (error) => {
      console.error('Error proxying image:', error.message);
      res.status(500).json({ error: 'Failed to load image' });
    });
  } catch (error) {
    console.error('Error in image proxy:', error);
    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

// GET all posts
app.get('/api/posts', async (req, res) => {
  try {
    // Ensure data directory exists
    await ensureDataDir();
    await initializePostsFile();
    
    const posts = await readPosts();
    const timestamp = new Date().toLocaleString('en-US', { 
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    console.log(`[${timestamp}] 📋 GET /api/posts - Returning ${posts.length} post(s)`);
    
    // Ensure we always return the correct format
    if (!Array.isArray(posts)) {
      console.error(`[${timestamp}] ⚠️ Posts is not an array, converting...`);
      const fixedPosts = Array.isArray(posts) ? posts : [];
      res.json({ success: true, data: fixedPosts });
    } else {
      res.json({ success: true, data: posts });
    }
  } catch (error) {
    const errorTime = new Date().toLocaleString('en-US', { 
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    console.error(`[${errorTime}] ❌ Error in GET /api/posts:`, error);
    console.error(`[${errorTime}] Error stack:`, error.stack);
    res.status(500).json({ success: false, error: error.message || 'Failed to load posts' });
  }
});

// POST new post
app.post('/api/posts', async (req, res) => {
  try {
    const { postUrl, imageUrl, likesCount } = req.body;

    if (!postUrl) {
      return res.status(400).json({ success: false, error: 'Post URL is required' });
    }

    const timestamp = new Date().toLocaleString('en-US', { 
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    console.log(`[${timestamp}] ➕ POST /api/posts - Adding new post: ${postUrl}`);

    const posts = await readPosts();
    const newPost = {
      id: Date.now(),
      postUrl,
      imageUrl: imageUrl || null,
      likesCount: likesCount || 0,
      addedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    posts.push(newPost);
    const success = await writePosts(posts);

    if (success) {
      console.log(`[${timestamp}] ✅ Post added successfully (ID: ${newPost.id})`);
      res.json({ success: true, data: newPost });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save post' });
    }
  } catch (error) {
    const errorTime = new Date().toLocaleString('en-US', { 
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    console.error(`[${errorTime}] ❌ Error in POST /api/posts:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT update post
app.put('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { imageUrl, likesCount } = req.body;

    const timestamp = new Date().toLocaleString('en-US', { 
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    console.log(`[${timestamp}] 🔄 PUT /api/posts/${id} - Updating post (Likes: ${likesCount || 'unchanged'})`);

    const posts = await readPosts();
    const postIndex = posts.findIndex(p => p.id === parseInt(id));

    if (postIndex === -1) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    posts[postIndex] = {
      ...posts[postIndex],
      imageUrl: imageUrl !== undefined ? imageUrl : posts[postIndex].imageUrl,
      likesCount: likesCount !== undefined ? likesCount : posts[postIndex].likesCount,
      lastUpdated: new Date().toISOString(),
    };

    const success = await writePosts(posts);

    if (success) {
      console.log(`[${timestamp}] ✅ Post updated successfully (ID: ${id}, New Likes: ${posts[postIndex].likesCount})`);
      res.json({ success: true, data: posts[postIndex] });
    } else {
      res.status(500).json({ success: false, error: 'Failed to update post' });
    }
  } catch (error) {
    const errorTime = new Date().toLocaleString('en-US', { 
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    console.error(`[${errorTime}] ❌ Error in PUT /api/posts:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE post
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const posts = await readPosts();
    const filteredPosts = posts.filter(p => p.id !== parseInt(id));

    if (posts.length === filteredPosts.length) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const success = await writePosts(filteredPosts);

    if (success) {
      res.json({ success: true, message: 'Post deleted successfully' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to delete post' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Catch all handler: send back React's index.html file for any non-API routes
// This allows React Router to handle client-side routing
app.get('*', (req, res) => {
  // Don't serve index.html for API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  res.sendFile(path.join(FRONTEND_BUILD, 'index.html'), (err) => {
    if (err) {
      console.error('Error serving index.html:', err);
      res.status(500).send('Error loading application. Make sure frontend is built: npm run build');
    }
  });
});

// Start server
initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
    console.log(`Frontend build: ${FRONTEND_BUILD}`);
    console.log(`Serving frontend: ${fs.existsSync(FRONTEND_BUILD) ? '✅ Found' : '❌ Not found - Run "npm run build" in frontend directory'}`);
  });
}).catch((error) => {
  console.error('Failed to initialize server:', error);
  process.exit(1);
});
