const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const T2_SERVICE_URL = 'http://69.197.187.24:4561';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'links.json');

// Middleware
app.use(cors());
app.use(express.json());
// Note: Static file serving moved to AFTER API routes

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fsPromises.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Initialize data file if it doesn't exist
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

// Initialize data directory and file on startup
ensureDataDir().then(() => {
  initializeDataFile();
});

// ==================== API ENDPOINTS ====================

// Health check endpoint (API endpoint)
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'FB Test API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    t2ServiceUrl: T2_SERVICE_URL
  });
});

// Health check endpoint (alternative)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Get all stored links
app.get('/api/links', async (req, res) => {
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

// Add a new link - processes photo via t2 service and stores result
app.post('/api/links', async (req, res) => {
  try {
    const { url, link } = req.body;
    const linkUrl = url || link;

    if (!linkUrl) {
      return res.status(400).json({
        success: false,
        error: 'URL is required',
        example: { url: 'https://www.facebook.com/photo?fbid=...' }
      });
    }

    const links = await readLinks();

    // Check if link already exists
    const existingLink = links.find(l => l.url === linkUrl);
    if (existingLink) {
      return res.status(400).json({
        success: false,
        error: 'Link already exists'
      });
    }

    console.log(`📥 Processing new link: ${linkUrl}`);

    // Call t2 service to process the photo
    let imageUrl = '';
    let reactionsCount = 0;
    let viewableImageUrl = '';

    try {
      console.log(`🔗 Calling t2 service: ${T2_SERVICE_URL}/process-photo`);
      const response = await axios.post(`${T2_SERVICE_URL}/process-photo`, {
        url: linkUrl
      }, {
        timeout: 60000 // 60 second timeout
      });

      if (response.data.success && response.data.data) {
        imageUrl = response.data.data.imageUrl || '';
        reactionsCount = parseInt(response.data.data.number) || 0;
        viewableImageUrl = response.data.data.viewableImageUrl || '';
        console.log(`✅ Photo processed: Image=${imageUrl ? 'Yes' : 'No'}, Reactions=${reactionsCount}`);
      } else {
        console.log('⚠️  T2 service returned success=false');
      }
    } catch (error) {
      console.error('❌ Error calling t2 service:', error.message);
      // Continue to save the link even if processing fails
      // User can retry processing later
    }

    // Create new link object
    const newLink = {
      id: Date.now().toString(),
      url: linkUrl,
      imageUrl: imageUrl,
      viewableImageUrl: viewableImageUrl,
      reactionsCount: reactionsCount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
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

// Update a link (re-process photo)
app.put('/api/links/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const links = await readLinks();
    const linkIndex = links.findIndex(l => l.id === id);

    if (linkIndex === -1) {
      return res.status(404).json({ success: false, error: 'Link not found' });
    }

    const link = links[linkIndex];
    console.log(`🔄 Re-processing link: ${link.url}`);

    // Call t2 service to re-process the photo
    try {
      const response = await axios.post(`${T2_SERVICE_URL}/process-photo`, {
        url: link.url
      }, {
        timeout: 60000
      });

      if (response.data.success && response.data.data) {
        links[linkIndex].imageUrl = response.data.data.imageUrl || '';
        links[linkIndex].reactionsCount = parseInt(response.data.data.number) || 0;
        links[linkIndex].viewableImageUrl = response.data.data.viewableImageUrl || '';
        links[linkIndex].updatedAt = new Date().toISOString();
        console.log(`✅ Link updated: Image=${links[linkIndex].imageUrl ? 'Yes' : 'No'}, Reactions=${links[linkIndex].reactionsCount}`);
      }
    } catch (error) {
      console.error('❌ Error re-processing link:', error.message);
      return res.status(500).json({
        success: false,
        error: `Failed to re-process link: ${error.message}`
      });
    }

    const success = await writeLinks(links);

    if (success) {
      res.json({ success: true, data: links[linkIndex] });
    } else {
      res.status(500).json({ success: false, error: 'Failed to update link' });
    }
  } catch (error) {
    console.error('Error updating link:', error);
    res.status(500).json({ success: false, error: 'Failed to update link' });
  }
});

// Delete a link
app.delete('/api/links/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const links = await readLinks();
    const filteredLinks = links.filter(link => link.id !== id);

    if (links.length === filteredLinks.length) {
      return res.status(404).json({ success: false, error: 'Link not found' });
    }

    const success = await writeLinks(filteredLinks);

    if (success) {
      console.log(`✅ Link deleted: ${id}`);
      res.json({ success: true, message: 'Link deleted successfully' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to delete link' });
    }
  } catch (error) {
    console.error('Error deleting link:', error);
    res.status(500).json({ success: false, error: 'Failed to delete link' });
  }
});

// Proxy endpoints to t2 service (for direct access if needed)

// Check t2 service status
app.get('/api/t2/status', async (req, res) => {
  try {
    const response = await axios.get(`${T2_SERVICE_URL}/status`, {
      timeout: 5000
    });
    res.json(response.data);
  } catch (error) {
    res.status(503).json({
      success: false,
      error: `Cannot connect to t2 service: ${error.message}`
    });
  }
});

// Process photo via t2 service (proxy)
app.post('/api/t2/process-photo', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    const response = await axios.post(`${T2_SERVICE_URL}/process-photo`, {
      url: url
    }, {
      timeout: 60000
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Failed to process photo: ${error.message}`
    });
  }
});

// Serve static files from public directory (AFTER all API routes)
app.use(express.static('public'));

// Serve frontend HTML for all other routes (catch-all)
app.get('*', (req, res) => {
  // Don't serve HTML for API routes
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend not found' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 FB Test Server is running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/links`);
  console.log(`🌐 Frontend: http://localhost:${PORT}/`);
  console.log(`🔗 T2 Service: ${T2_SERVICE_URL}`);
  console.log(`💾 Storing links in: ${DATA_FILE}`);
});

