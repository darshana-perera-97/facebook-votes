import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { scrapePost, addPost } from '../utils/api';

function AddPost() {
  const [postUrl, setPostUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // First scrape the post
      const scrapeData = await scrapePost(postUrl);

      if (scrapeData.success) {
        // Then add it to the database
        const addData = await addPost({
          postUrl: scrapeData.data.postUrl,
          imageUrl: scrapeData.data.imageUrl,
          likesCount: scrapeData.data.likesCount,
        });

        if (addData.success) {
          setPostUrl('');
          navigate('/preview');
        }
      }
    } catch (err) {
      setError(err.message || 'Error connecting to server. Make sure the backend is running.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-post-container">
      <div className="add-post-card">
        <h1 className="add-post-title">Add Facebook Post</h1>
        <p className="add-post-subtitle">Enter a Facebook post URL to scrape its data</p>
        
        <form onSubmit={handleSubmit} className="add-post-form">
          <div className="input-group">
            <label htmlFor="postUrl">Post URL</label>
            <input
              type="url"
              id="postUrl"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder="https://web.facebook.com/photo/?fbid=..."
              required
              disabled={loading}
              className="url-input"
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button
            type="submit"
            disabled={loading || !postUrl.trim()}
            className="submit-button"
          >
            {loading ? 'Scraping...' : 'Add Post'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AddPost;

