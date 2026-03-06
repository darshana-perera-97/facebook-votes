import { API_BASE_URL } from '../config/api';

export const scrapePost = async (postUrl) => {
  const response = await fetch(`${API_BASE_URL}/api/scrape-post`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ postUrl }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Failed to scrape post');
  }

  return data;
};

export const getPosts = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/posts`);
    
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to fetch posts (${response.status})`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    if (error.message.includes('fetch')) {
      throw new Error('Cannot connect to server. Make sure the backend is running on http://localhost:3001');
    }
    throw error;
  }
};

export const addPost = async (postData) => {
  const response = await fetch(`${API_BASE_URL}/api/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postData),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Failed to add post');
  }

  return data;
};

export const updatePost = async (id, postData) => {
  const response = await fetch(`${API_BASE_URL}/api/posts/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postData),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Failed to update post');
  }

  return data;
};

export const deletePost = async (id) => {
  const response = await fetch(`${API_BASE_URL}/api/posts/${id}`, {
    method: 'DELETE',
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Failed to delete post');
  }

  return data;
};

