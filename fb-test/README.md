# FB Test - Facebook Links Manager

A Node.js application that stores Facebook photo links with images and reaction counts. Uses the t2 service APIs for processing photos.

## Features

- ✅ Add Facebook photo links
- ✅ Automatically extract image and reaction count via t2 service
- ✅ View all stored links in a card-based UI
- ✅ Refresh/re-process links to update data
- ✅ Delete links
- ✅ Beautiful, responsive frontend

## Prerequisites

- Node.js (v14 or higher)
- t2 service running at `http://69.197.187.24:4561`

## Installation

1. Install dependencies:
```bash
npm install
```

## Configuration

The t2 service URL can be configured via environment variable:
```bash
T2_SERVICE_URL=http://69.197.187.24:4561 npm start
```

Or modify the `T2_SERVICE_URL` constant in `index.js`.

## Usage

1. Start the server:
```bash
npm start
```

2. Open your browser and navigate to:
```
http://localhost:3000
```

## API Endpoints

### Get All Links
- **GET** `/api/links`
- Returns all stored links with images and reaction counts

### Add New Link
- **POST** `/api/links`
- Body: `{ "url": "https://www.facebook.com/photo?fbid=..." }`
- Automatically processes the photo via t2 service and stores the result

### Update/Refresh Link
- **PUT** `/api/links/:id`
- Re-processes the photo to update image and reaction count

### Delete Link
- **DELETE** `/api/links/:id`
- Removes the link from storage

### T2 Service Status
- **GET** `/api/t2/status`
- Checks if t2 service is ready

### Process Photo (Proxy)
- **POST** `/api/t2/process-photo`
- Body: `{ "url": "https://www.facebook.com/photo?fbid=..." }`
- Direct proxy to t2 service

## Data Storage

Links are stored in `data/links.json` as a JSON array.

## Project Structure

```
fb-test/
├── index.js          # Backend server
├── package.json       # Dependencies
├── public/           # Frontend files
│   └── index.html    # Main HTML interface
├── data/             # Data storage
│   └── links.json    # Stored links (auto-created)
└── README.md         # This file
```

## Port

Default port: `3000` (configurable via `PORT` environment variable)

