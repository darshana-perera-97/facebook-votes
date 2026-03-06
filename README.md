# Facebook Votes

A modern web application to scrape and preview Facebook post data including images and like counts.

## Features

- 🎨 Modern, minimalistic UI
- 📱 Responsive design
- 🔗 Add Facebook post URLs
- 🖼️ View post previews with images
- ❤️ Display like counts
- 💾 Local storage for posts

## Setup

### Backend

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. **Install Playwright browsers (REQUIRED for Linux servers):**
```bash
npx playwright install chromium
```

4. **For Linux servers, install system dependencies:**
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2

# Or use Playwright's install script
npx playwright install-deps chromium
```

5. Start the backend server:
```bash
npm start
```

The backend API will run on `http://localhost:4041` (or the port specified in PORT env variable)

### Frontend

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the frontend development server:
```bash
npm start
```

The frontend will run on `http://localhost:3000`

## Usage

1. Make sure both backend and frontend servers are running
2. Open `http://localhost:3000` in your browser
3. Navigate to "Add Post" page
4. Enter a Facebook post URL (e.g., `https://web.facebook.com/photo/?fbid=...`)
5. Click "Add Post" to scrape the post data
6. View the preview on the "Preview" page

## API Endpoint

### POST `/api/scrape-post`

Scrapes a Facebook post and returns the image URL and like count.

**Request:**
```json
{
  "postUrl": "https://web.facebook.com/photo/?fbid=..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "postUrl": "...",
    "imageUrl": "...",
    "likesCount": 1234
  }
}
```

## Technologies

- **Backend:** Node.js, Express, Playwright
- **Frontend:** React, React Router
- **Styling:** CSS3 with modern gradients and animations

