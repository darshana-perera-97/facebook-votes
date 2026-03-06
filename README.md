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

3. Start the backend server:
```bash
npm start
```

The backend API will run on `http://localhost:3001`

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

