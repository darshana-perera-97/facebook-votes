// API Configuration
// Use relative URL when in production (served from same origin)
// Use localhost when in development
const isDevelopment = process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
// export const API_BASE_URL = 'http://localhost:4041';
export const API_BASE_URL ='http://69.197.187.24:4041';
