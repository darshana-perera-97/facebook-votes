import React, { useState, useEffect, useRef } from 'react';
import { scrapePost, getPosts, addPost, updatePost, deletePost } from '../utils/api';

function PostPreview() {
  const [posts, setPosts] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPostUrl, setNewPostUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatingPosts, setUpdatingPosts] = useState(new Set());
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [lastRefreshTime, setLastRefreshTime] = useState(null);
  const [nextRefreshIn, setNextRefreshIn] = useState(60);
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

  // Load posts from API on mount
  useEffect(() => {
    loadPosts();
  }, []);

  const loadPosts = async () => {
    try {
      setLoadingPosts(true);
      setError('');
      const response = await getPosts();
      if (response.success) {
        setPosts(response.data || []);
        setLastRefreshTime(new Date());
      } else {
        setError(response.error || 'Failed to load posts');
      }
    } catch (err) {
      console.error('Error loading posts:', err);
      const errorMessage = err.message || 'Failed to load posts. Make sure the backend server is running';
      setError(errorMessage);
    } finally {
      setLoadingPosts(false);
    }
  };

  // Refresh all posts
  const refreshAllPosts = async () => {
    // Get current posts - use a ref or load fresh from API
    const currentPosts = await getPosts().then(res => res.success ? res.data : []);
    
    if (currentPosts.length === 0) return;

    const updatingIds = new Set();

    // Refresh each post
    for (const post of currentPosts) {
      updatingIds.add(post.id);

      try {
        const scrapeData = await scrapePost(post.postUrl);
        if (scrapeData.success) {
          await updatePost(post.id, {
            imageUrl: scrapeData.data.imageUrl || post.imageUrl,
            likesCount: scrapeData.data.likesCount || 0,
          });
        }
      } catch (err) {
        console.error(`Error refreshing post ${post.id}:`, err);
      }
    }

    setUpdatingPosts(updatingIds);
    
    // Reload posts from API to get updated data
    await loadPosts();

    setTimeout(() => {
      setUpdatingPosts(new Set());
    }, 1000);
  };

  // Countdown timer for next refresh
  useEffect(() => {
    if (posts.length === 0) {
      setNextRefreshIn(60);
      return;
    }

    countdownRef.current = setInterval(() => {
      setNextRefreshIn((prev) => {
        if (prev <= 1) {
          return 60; // Reset to 60 seconds
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, [posts.length, lastRefreshTime]);

  // Auto-refresh every 1 minute
  useEffect(() => {
    if (posts.length === 0) return;

    const refreshPosts = async () => {
      console.log('Auto-refreshing posts...');
      setNextRefreshIn(60); // Reset countdown
      setLastRefreshTime(new Date());
      await refreshAllPosts();
    };

    // Set up interval to refresh every 1 minute (60000ms)
    intervalRef.current = setInterval(refreshPosts, 60000);

    // Cleanup interval on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [posts.length]); // Only re-run when number of posts changes

  const handleAddPost = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // First scrape the post
      const scrapeData = await scrapePost(newPostUrl);

      if (scrapeData.success) {
        // Then add it to the database
        const addData = await addPost({
          postUrl: scrapeData.data.postUrl,
          imageUrl: scrapeData.data.imageUrl,
          likesCount: scrapeData.data.likesCount,
        });

        if (addData.success) {
          // Reload posts from API
          await loadPosts();
          setNewPostUrl('');
          setShowAddModal(false);
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to add post');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deletePost(id);
      // Reload posts from API
      await loadPosts();
    } catch (err) {
      console.error('Error deleting post:', err);
      setError('Failed to delete post');
    }
  };

  const handleRefreshPost = async (postId) => {
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    setUpdatingPosts(new Set([postId]));

    try {
      const scrapeData = await scrapePost(post.postUrl);
      if (scrapeData.success) {
        await updatePost(postId, {
          imageUrl: scrapeData.data.imageUrl || post.imageUrl,
          likesCount: scrapeData.data.likesCount || 0,
        });
        // Reload posts from API
        await loadPosts();
      }
    } catch (err) {
      console.error(`Error refreshing post ${postId}:`, err);
    } finally {
      setTimeout(() => {
        setUpdatingPosts(prev => {
          const newSet = new Set(prev);
          newSet.delete(postId);
          return newSet;
        });
      }, 500);
    }
  };

  if (loadingPosts) {
    return (
      <div className="preview-container">
        <div className="empty-state">
          <div className="empty-icon">⏳</div>
          <h2>Loading posts...</h2>
          {error && <p className="error-message" style={{ marginTop: '1rem' }}>{error}</p>}
        </div>
      </div>
    );
  }

  if (posts.length === 0 && !showAddModal) {
    return (
      <div className="preview-container">
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <h2>No posts yet</h2>
          <p>Add your first Facebook post to see it here</p>
          {error && (
            <div className="error-message" style={{ marginBottom: '1rem', maxWidth: '400px', margin: '1rem auto' }}>
              {error}
            </div>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="empty-button"
          >
            Add Post
          </button>
        </div>

        {/* Add Post Modal */}
        {showAddModal && (
          <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button
                className="modal-close"
                onClick={() => setShowAddModal(false)}
              >
                ×
              </button>
              <h2>Add Facebook Post</h2>
              <form onSubmit={handleAddPost} className="add-post-form">
                <div className="input-group">
                  <label htmlFor="newPostUrl">Post URL</label>
                  <input
                    type="url"
                    id="newPostUrl"
                    value={newPostUrl}
                    onChange={(e) => setNewPostUrl(e.target.value)}
                    placeholder="https://web.facebook.com/photo/?fbid=..."
                    required
                    disabled={loading}
                    className="url-input"
                  />
                </div>
                {error && <div className="error-message">{error}</div>}
                <button
                  type="submit"
                  disabled={loading || !newPostUrl.trim()}
                  className="submit-button"
                >
                  {loading ? 'Scraping...' : 'Add Post'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="preview-container">
      <div className="preview-header">
        <div>
          <h1>Post Previews</h1>
          {lastRefreshTime && (
            <div className="refresh-status">
              <span className="refresh-indicator">🔄 Auto-refresh active</span>
              <span className="refresh-time">
                Last updated: {lastRefreshTime.toLocaleTimeString()}
              </span>
              <span className="refresh-countdown">
                Next refresh in: {nextRefreshIn}s
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="add-button"
        >
          + Add New Post
        </button>
      </div>

      {error && (
        <div className="error-message" style={{ marginBottom: '2rem', maxWidth: '600px', marginLeft: 'auto', marginRight: 'auto' }}>
          {error}
          <button
            onClick={loadPosts}
            style={{
              marginLeft: '1rem',
              padding: '0.5rem 1rem',
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div className="posts-grid">
        {posts.map((post) => (
          <div key={post.id} className="post-card">
            <button
              className="delete-button"
              onClick={() => handleDelete(post.id)}
              aria-label="Delete post"
            >
              ×
            </button>

            <button
              className="refresh-button"
              onClick={() => handleRefreshPost(post.id)}
              disabled={updatingPosts.has(post.id)}
              aria-label="Refresh post"
              title="Refresh likes count"
            >
              {updatingPosts.has(post.id) ? '⟳' : '↻'}
            </button>

            {post.imageUrl ? (
              <div className="post-image-container">
                <img
                  src={post.imageUrl}
                  alt="Facebook post"
                  className="post-image"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
                <div className="image-placeholder" style={{ display: 'none' }}>
                  <span>Image not available</span>
                </div>
              </div>
            ) : (
              <div className="image-placeholder">
                <span>No image available</span>
              </div>
            )}

            <div className="post-info">
              <div className="likes-count">
                <span className="likes-icon">❤️</span>
                <span className={`likes-number ${updatingPosts.has(post.id) ? 'updating' : ''}`}>
                  {post.likesCount.toLocaleString()}
                </span>
                <span className="likes-label">likes</span>
                {updatingPosts.has(post.id) && (
                  <span className="updating-indicator">Updating...</span>
                )}
              </div>

              {post.lastUpdated && (
                <div className="last-updated">
                  Updated: {new Date(post.lastUpdated).toLocaleTimeString()}
                </div>
              )}

              <a
                href={post.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="post-link"
              >
                View on Facebook →
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Add Post Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setShowAddModal(false)}
            >
              ×
            </button>
            <h2>Add Facebook Post</h2>
            <form onSubmit={handleAddPost} className="add-post-form">
              <div className="input-group">
                <label htmlFor="newPostUrl">Post URL</label>
                <input
                  type="url"
                  id="newPostUrl"
                  value={newPostUrl}
                  onChange={(e) => setNewPostUrl(e.target.value)}
                  placeholder="https://web.facebook.com/photo/?fbid=..."
                  required
                  disabled={loading}
                  className="url-input"
                />
              </div>
              {error && <div className="error-message">{error}</div>}
              <button
                type="submit"
                disabled={loading || !newPostUrl.trim()}
                className="submit-button"
              >
                {loading ? 'Scraping...' : 'Add Post'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default PostPreview;
