const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4042;
const FRONTEND_BUILD = path.join(__dirname, '..', 'frontend', 'build');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
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

// Initialize data.json if it doesn't exist
async function initializeDataFile() {
  try {
    await fsPromises.access(DATA_FILE);
  } catch (error) {
    // File doesn't exist, create it with empty array
    await fsPromises.writeFile(DATA_FILE, JSON.stringify([], null, 2));
  }
}

// Read links from file
async function readLinks() {
  try {
    const data = await fsPromises.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading links:', error);
    return [];
  }
}

// Write links to file
async function writeLinks(links) {
  try {
    await fsPromises.writeFile(DATA_FILE, JSON.stringify(links, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing links:', error);
    return false;
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

// Read posts from file
async function readPosts() {
  try {
    const data = await fsPromises.readFile(URLS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading posts:', error);
    return [];
  }
}

// Write posts to file
async function writePosts(posts) {
  try {
    await fsPromises.writeFile(URLS_FILE, JSON.stringify(posts, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing posts:', error);
    return false;
  }
}


// Initialize data directory and files on startup
ensureDataDir().then(() => {
  initializeDataFile();
  initializeUrlsFile();
});

// Root API endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Get all links
app.get('/links', async (req, res) => {
  try {
    const links = await readLinks();
    res.json({
      success: true,
      data: links,
      count: links.length
    });
  } catch (error) {
    console.error('Error fetching links:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch links' });
  }
});

// Add a new link - automatically scrapes to get image and likes count
app.post('/links', async (req, res) => {
  try {
    const { link, url } = req.body;
    
    // Accept either 'link' or 'url' field
    const linkUrl = link || url;
    
    if (!linkUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'Link/URL is required' 
      });
    }

    const links = await readLinks();
    
    // Check if link already exists
    const existingLink = links.find(l => l.url === linkUrl || l.link === linkUrl);
    if (existingLink) {
      return res.status(400).json({ 
        success: false, 
        error: 'Link already exists' 
      });
    }

    // Create new link object
    const newLink = {
      id: Date.now().toString(),
      url: linkUrl,
      imageUrl: '',
      likesCount: 0,
      createdAt: new Date().toISOString()
    };

    links.push(newLink);
    const success = await writeLinks(links);

    if (success) {
      console.log(`✅ Link saved: ${linkUrl}`);
      res.json({ success: true, data: newLink });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save link' });
    }
  } catch (error) {
    console.error('Error adding link:', error);
    res.status(500).json({ success: false, error: 'Failed to add link' });
  }
});

// Delete a link
app.delete('/links/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const links = await readLinks();
    const filteredLinks = links.filter(link => link.id !== id);

    if (links.length === filteredLinks.length) {
      return res.status(404).json({ success: false, error: 'Link not found' });
    }

    const success = await writeLinks(filteredLinks);

    if (success) {
      res.json({ success: true, message: 'Link deleted successfully' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to delete link' });
    }
  } catch (error) {
    console.error('Error deleting link:', error);
    res.status(500).json({ success: false, error: 'Failed to delete link' });
  }
});

// Facebook Posts API Endpoints

// Process photo endpoint - forwards to t2 service and returns only image link and reactions count
app.post('/api/process-photo', async (req, res) => {
  try {
    const { url, link, postUrl } = req.body;
    
    // Accept url, link, or postUrl field
    const photoUrl = url || link || postUrl;
    
    if (!photoUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL is required',
        example: { url: 'https://www.facebook.com/photo?fbid=...' }
      });
    }

    console.log(`📥 Process photo request received for: ${photoUrl}`);
    
    // Forward request to t2 service (assuming it runs on port 4561)
    const T2_SERVICE_URL = 'http://69.197.187.24:4561';
    // const T2_SERVICE_URL = process.env.T2_SERVICE_URL || 'http://localhost:4561';
    
    try {
      const response = await fetch(`${T2_SERVICE_URL}/process-photo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: photoUrl })
      });

      const data = await response.json();

      if (response.ok && data.success && data.data) {
        // Return only image link and number of reactions (don't store anything)
        res.json({
          success: true,
          imageUrl: data.data.imageUrl || data.data.viewableImageUrl || '',
          reactionsCount: data.data.number || 0,
          message: 'Photo processed successfully'
        });
      } else {
        res.status(response.status || 500).json({
          success: false,
          error: data.error || 'Failed to process photo'
        });
      }
    } catch (fetchError) {
      console.error('❌ Error calling t2 service:', fetchError.message);
      res.status(503).json({
        success: false,
        error: `Cannot connect to t2 service at ${T2_SERVICE_URL}. Make sure t2/index.js is running on port 4561.`
      });
    }
  } catch (error) {
    console.error('❌ Error processing photo request:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to process photo' 
    });
  }
});

// Scrape post endpoint (disabled - scraper removed)
app.post('/api/scrape-post', async (req, res) => {
  res.status(501).json({ 
    success: false, 
    error: 'Scraping functionality has been removed. Use /api/process-photo instead.' 
  });
});

// Get all posts
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await readPosts();
    res.json({ success: true, data: posts });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

// Add a new post
app.post('/api/posts', async (req, res) => {
  try {
    const { postUrl, imageUrl, likesCount } = req.body;
    
    if (!postUrl) {
      return res.status(400).json({ success: false, error: 'Post URL is required' });
    }

    const posts = await readPosts();
    
    // Check if URL already exists
    const existingPost = posts.find(p => p.postUrl === postUrl);
    if (existingPost) {
      return res.status(400).json({ success: false, error: 'URL already exists' });
    }

    // Use provided values or defaults
    let finalImageUrl = imageUrl || '';
    let finalLikesCount = likesCount || 0;

    // Create new post object
    const newPost = {
      id: Date.now().toString(),
      postUrl: postUrl,
      imageUrl: finalImageUrl,
      likesCount: finalLikesCount,
      createdAt: new Date().toISOString(),
    };

    posts.push(newPost);
    const success = await writePosts(posts);

    if (success) {
      console.log(`✅ Post saved: ${postUrl} (Image: ${finalImageUrl ? 'Yes' : 'No'}, Likes: ${finalLikesCount})`);
      res.json({ success: true, data: newPost });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save post' });
    }
  } catch (error) {
    console.error('Error adding post:', error);
    res.status(500).json({ success: false, error: 'Failed to add post' });
  }
});

// Update a post
app.put('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { postUrl, imageUrl, likesCount } = req.body;

    const posts = await readPosts();
    const index = posts.findIndex(p => p.id === id);

    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    // Update the post
    if (postUrl) posts[index].postUrl = postUrl;
    if (imageUrl !== undefined) posts[index].imageUrl = imageUrl;
    if (likesCount !== undefined) posts[index].likesCount = likesCount;
    posts[index].updatedAt = new Date().toISOString();

    const success = await writePosts(posts);

    if (success) {
      res.json({ success: true, data: posts[index] });
    } else {
      res.status(500).json({ success: false, error: 'Failed to update post' });
    }
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({ success: false, error: 'Failed to update post' });
  }
});

// Delete a post
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const posts = await readPosts();
    const filteredPosts = posts.filter(p => p.id !== id);

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

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Process photo: POST http://localhost:${PORT}/api/process-photo`);
  console.log(`💾 Storing links in: ${DATA_FILE}`);
  console.log(`📝 Storing posts in: ${URLS_FILE}`);
  console.log(`\n💡 Note: /api/process-photo forwards to t2 service (http://localhost:4561)`);
  console.log(`   Make sure t2/index.js is running for photo processing to work.`);
  
  // Check if build folder exists
  if (!fs.existsSync(FRONTEND_BUILD)) {
    console.warn(`⚠️  Warning: Frontend build folder not found at ${FRONTEND_BUILD}`);
    console.warn(`   Please run "npm run build" in the frontend directory.`);
  } else {
    console.log(`✅ Frontend build folder found - serving frontend from: ${FRONTEND_BUILD}`);
  }
});

