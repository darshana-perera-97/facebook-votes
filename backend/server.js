const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 4041;
const FRONTEND_BUILD = path.join(__dirname, '..', 'frontend', 'build');
const DATA_DIR = path.join(__dirname, 'data');
const URLS_FILE = path.join(DATA_DIR, 'urls.json');

// Middleware
app.use(cors());
app.use(express.json());

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fsPromises.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Initialize urls.json if it doesn't exist
async function initializeUrlsFile() {
  try {
    await fsPromises.access(URLS_FILE);
  } catch (error) {
    // File doesn't exist, create it with empty array
    await fsPromises.writeFile(URLS_FILE, JSON.stringify([], null, 2));
  }
}

// Read URLs from file
async function readUrls() {
  try {
    const data = await fsPromises.readFile(URLS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading URLs:', error);
    return [];
  }
}

// Write URLs to file
async function writeUrls(urls) {
  try {
    await fsPromises.writeFile(URLS_FILE, JSON.stringify(urls, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing URLs:', error);
    return false;
  }
}

// Initialize data directory and file on startup
ensureDataDir().then(() => {
  initializeUrlsFile();
});

// API Routes

// Helper function to delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Scrape post endpoint - extracts image URL and likes count
app.post('/api/scrape-post', async (req, res) => {
  try {
    const { postUrl } = req.body;
    
    if (!postUrl) {
      return res.status(400).json({ success: false, error: 'Post URL is required' });
    }

    console.log(`📸 Scraping Facebook post: ${postUrl}`);
    const scrapedData = await scrapePostData(postUrl);

    // Return scraped data
    res.json({
      success: true,
      data: {
        postUrl: postUrl,
        imageUrl: scrapedData.imageUrl,
        likesCount: scrapedData.likesCount,
      }
    });

  } catch (error) {
    console.error('❌ Error scraping post:', error);
    res.status(500).json({ 
      success: false, 
      error: `Failed to scrape post: ${error.message}` 
    });
  }
});

// Get all posts/URLs
app.get('/api/posts', async (req, res) => {
  try {
    const urls = await readUrls();
    res.json({ success: true, data: urls });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

// Helper function to scrape a post (extracted for reuse)
async function scrapePostData(postUrl) {
  let browser = null;
  let context = null;
  try {
    console.log(`📸 Scraping Facebook post: ${postUrl}`);

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Create context with user agent and viewport
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Navigate to the post URL
    await page.goto(postUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    // Wait for page to load
    await delay(3000);

    // Extract likes count
    let likesCount = 0;
    try {
      const numberSelectors = [
        'span.x135b78x',
        'span[class*="x135b78x"]',
        'span[class="x135b78x"]',
        'span[aria-label*="like"]',
        'span[aria-label*="Like"]'
      ];

      for (const selector of numberSelectors) {
        try {
          const number = await page.evaluate((sel) => {
            const span = document.querySelector(sel);
            if (span) {
              const text = span.textContent.trim();
              const match = text.match(/[\d.]+[KMB]?/);
              if (match) {
                let num = parseFloat(match[0]);
                if (text.includes('K')) num *= 1000;
                if (text.includes('M')) num *= 1000000;
                return Math.floor(num);
              }
              if (/^\d+$/.test(text)) {
                return parseInt(text);
              }
            }
            return null;
          }, selector);

          if (number) {
            likesCount = number;
            break;
          }
        } catch (e) {
          // Continue
        }
      }
  } catch (error) {
      console.log('⚠️  Could not extract likes count');
    }

    // Extract image URL
    let imageUrl = '';
    try {
      const imageData = await page.evaluate(() => {
        const allImages = Array.from(document.querySelectorAll('img'));
        const mainImageSelectors = [
          'img[src*="scontent"]',
          'img[src*="fbcdn"]',
          'img[data-imgperflogname]',
          'div[role="img"] img',
          'img[alt*="photo"]'
        ];

        let mainImage = null;

        for (const selector of mainImageSelectors) {
          const img = document.querySelector(selector);
          if (img && img.src && img.src.includes('http')) {
            const src = img.src.replace(/&amp;/g, '&');
            const width = img.naturalWidth || img.width || 0;
            const height = img.naturalHeight || img.height || 0;
            
            if (!mainImage || (width * height > (mainImage.width * mainImage.height || 0))) {
              mainImage = {
                url: src,
                width: width,
                height: height
              };
            }
          }
        }

        if (!mainImage && allImages.length > 0) {
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
            mainImage = {
              url: img.src.replace(/&amp;/g, '&'),
              width: img.naturalWidth || img.width || 0,
              height: img.naturalHeight || img.height || 0
            };
          }
        }

        return mainImage ? mainImage.url : null;
      });

      if (imageData) {
        imageUrl = imageData;
      }
    } catch (error) {
      console.log('⚠️  Error extracting image URL');
    }

    await context.close();
    await browser.close();
    return { imageUrl, likesCount };
  } catch (error) {
    if (context) {
      try {
        await context.close();
      } catch (e) {}
    }
    if (browser) {
      try {
  await browser.close();
      } catch (e) {}
    }
    throw error;
  }
}

// Add a new post/URL - automatically scrapes if imageUrl and likesCount are not provided
app.post('/api/posts', async (req, res) => {
  try {
    const { postUrl, imageUrl, likesCount } = req.body;

    if (!postUrl) {
      return res.status(400).json({ success: false, error: 'Post URL is required' });
    }

    const urls = await readUrls();
    
    // Check if URL already exists
    const existingUrl = urls.find(url => url.postUrl === postUrl);
    if (existingUrl) {
      return res.status(400).json({ success: false, error: 'URL already exists' });
    }

    // If imageUrl or likesCount are missing, scrape the post
    let finalImageUrl = imageUrl || '';
    let finalLikesCount = likesCount || 0;

    if (!finalImageUrl || finalLikesCount === 0) {
      console.log('🔍 Auto-scraping post data...');
      try {
        const scrapedData = await scrapePostData(postUrl);
        if (!finalImageUrl && scrapedData.imageUrl) {
          finalImageUrl = scrapedData.imageUrl;
        }
        if (finalLikesCount === 0 && scrapedData.likesCount) {
          finalLikesCount = scrapedData.likesCount;
        }
      } catch (error) {
        console.log('⚠️  Auto-scrape failed, using provided/default values:', error.message);
      }
    }

    // Create new post object
    const newPost = {
      id: Date.now().toString(),
      postUrl: postUrl,
      imageUrl: finalImageUrl,
      likesCount: finalLikesCount,
      createdAt: new Date().toISOString(),
    };

    urls.push(newPost);
    const success = await writeUrls(urls);

    if (success) {
      console.log(`✅ Post saved: ${postUrl} (Image: ${finalImageUrl ? 'Yes' : 'No'}, Likes: ${finalLikesCount})`);
      res.json({ success: true, data: newPost });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save URL' });
    }
  } catch (error) {
    console.error('Error adding post:', error);
    res.status(500).json({ success: false, error: 'Failed to add post' });
  }
});

// Update a post/URL
app.put('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { postUrl, imageUrl, likesCount } = req.body;

    const urls = await readUrls();
    const index = urls.findIndex(url => url.id === id);

    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    // Update the post
    if (postUrl) urls[index].postUrl = postUrl;
    if (imageUrl !== undefined) urls[index].imageUrl = imageUrl;
    if (likesCount !== undefined) urls[index].likesCount = likesCount;
    urls[index].updatedAt = new Date().toISOString();

    const success = await writeUrls(urls);

    if (success) {
      res.json({ success: true, data: urls[index] });
    } else {
      res.status(500).json({ success: false, error: 'Failed to update post' });
    }
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({ success: false, error: 'Failed to update post' });
  }
});

// Delete a post/URL
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const urls = await readUrls();
    const filteredUrls = urls.filter(url => url.id !== id);

    if (urls.length === filteredUrls.length) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const success = await writeUrls(filteredUrls);

    if (success) {
      res.json({ success: true, message: 'Post deleted successfully' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to delete post' });
    }
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ success: false, error: 'Failed to delete post' });
  }
});

// Serve static files from the React app (after API routes)
app.use(express.static(FRONTEND_BUILD, {
  maxAge: '1d', // Cache static assets for 1 day
  etag: true
}));

// Handle React routing, return all requests to React app
app.get('*', (req, res) => {
  // Don't serve index.html for API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  const indexPath = path.join(FRONTEND_BUILD, 'index.html');
  
  // Check if index.html exists
  if (!fs.existsSync(indexPath)) {
    return res.status(404).json({ 
      error: 'Frontend build not found. Please run "npm run build" in the frontend directory.' 
    });
  }
  
  res.sendFile(indexPath);
});

// Background job to refresh likesCount every 1 minute
async function refreshAllLikesCount() {
  try {
    const urls = await readUrls();
    
    if (urls.length === 0) {
      return; // No posts to refresh
    }

    console.log(`🔄 Refreshing likes count for ${urls.length} post(s)...`);
    
    let updatedCount = 0;
    
    // Refresh each post
    for (const post of urls) {
      try {
        console.log(`   Refreshing post ${post.id}...`);
        const scrapedData = await scrapePostData(post.postUrl);
        
        // Update the post with new data
        const postIndex = urls.findIndex(p => p.id === post.id);
        if (postIndex !== -1) {
          // Only update if we got new data
          if (scrapedData.likesCount > 0) {
            urls[postIndex].likesCount = scrapedData.likesCount;
          }
          if (scrapedData.imageUrl) {
            urls[postIndex].imageUrl = scrapedData.imageUrl;
          }
          urls[postIndex].updatedAt = new Date().toISOString();
          updatedCount++;
        }
        
        // Small delay between requests to avoid overwhelming Facebook
        await delay(2000);
      } catch (error) {
        console.error(`   ❌ Error refreshing post ${post.id}:`, error.message);
        // Continue with next post even if one fails
      }
    }
    
    // Save updated posts
    if (updatedCount > 0) {
      await writeUrls(urls);
      console.log(`✅ Updated ${updatedCount} post(s) successfully`);
    } else {
      console.log(`ℹ️  No posts were updated`);
    }
  } catch (error) {
    console.error('❌ Error in background refresh job:', error);
  }
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Serving frontend from: ${FRONTEND_BUILD}`);
  console.log(`Storing URLs in: ${URLS_FILE}`);
  
  // Check if build folder exists
  if (!fs.existsSync(FRONTEND_BUILD)) {
    console.warn(`⚠️  Warning: Frontend build folder not found at ${FRONTEND_BUILD}`);
    console.warn(`   Please run "npm run build" in the frontend directory.`);
  } else {
    console.log(`✅ Frontend build folder found`);
  }
  
  // Start background job to refresh likesCount every 1 minute (60000ms)
  console.log(`🔄 Starting background job to refresh likesCount every 1 minute...`);
  setInterval(refreshAllLikesCount, 60000); // 60000ms = 1 minute
  
  // Run initial refresh after 10 seconds (to let server fully start)
  setTimeout(() => {
    console.log(`🔄 Running initial refresh...`);
    refreshAllLikesCount();
  }, 10000);
});
