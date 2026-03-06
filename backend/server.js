const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
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

// Initialize on startup
async function initialize() {
  await ensureDataDir();
  await initializePostsFile();
  console.log('Data directory initialized');
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
  const imageSelectors = [
    'img[src*="scontent"]',
    'img[alt*="photo"]',
    'div[role="img"] img',
    'img[data-imgperflogname]',
  ];

  for (const selector of imageSelectors) {
    try {
      const img = await page.$(selector);
      if (img) {
        imageUrl = await img.getAttribute('src');
        if (imageUrl && imageUrl.includes('scontent')) {
          break;
        }
      }
    } catch (e) {
      continue;
    }
  }
  return imageUrl;
}

// Helper function to extract likes count from x135b78x class
async function extractLikesCount(page) {
  let likesCount = null;
  let numbers = [];

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

  // Fallback: Try to find reactions in other ways
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

  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Set longer timeout for navigation
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);

  try {
    console.log(`[${timestamp}] 📥 Navigating to post...`);
    // Use 'load' instead of 'networkidle' as it's more reliable
    // 'networkidle' can timeout if page has continuous network activity
    await page.goto(postUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Close login popup if present
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
    const imageUrl = await extractImageUrl(page);
    const likesCount = await extractLikesCount(page);

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
    console.log(`[${endTime}] ✅ Scraping completed - Likes: ${likesCount}, Image: ${imageUrl ? 'Found' : 'Not found'}`);

    res.json({
      success: true,
      data: {
        postUrl,
        imageUrl: imageUrl || null,
        likesCount: likesCount || 0,
      },
    });
  } catch (error) {
    await browser.close();
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
    res.json({ success: true, data: posts });
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
    res.status(500).json({ success: false, error: error.message });
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
