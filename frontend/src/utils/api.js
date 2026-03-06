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
    const url = `${API_BASE_URL}/api/posts`;
    console.log('Fetching posts from:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.error('Failed to fetch posts:', response.status, data);
      throw new Error(data.error || `Failed to fetch posts (${response.status})`);
    }
    
    const data = await response.json();
    console.log('Posts fetched successfully:', data);
    return data;
  } catch (error) {
    console.error('Error in getPosts:', error);
    if (error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
      throw new Error(`Cannot connect to server at ${API_BASE_URL || 'backend'}. Make sure the backend is running.`);
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

