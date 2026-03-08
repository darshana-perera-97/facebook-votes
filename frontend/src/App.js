import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [links, setLinks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadingLinks, setLoadingLinks] = useState(true);

  const API_BASE_URL = process.env.NODE_ENV === 'development' || 
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1'
    ? 'http://localhost:4042' 
    : `${window.location.protocol}//${window.location.hostname}:4042`;

  // Fetch links on component mount
  useEffect(() => {
    loadLinks();
  }, []);

  const loadLinks = async () => {
    try {
      setLoadingLinks(true);
      const response = await fetch(`${API_BASE_URL}/links`);
      const data = await response.json();
      
      if (data.success) {
        setLinks(data.data || []);
      }
    } catch (err) {
      console.error('Error loading links:', err);
    } finally {
      setLoadingLinks(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (!link.trim()) {
      setError('Please enter a Facebook link');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ link: link.trim() }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess('Facebook link added successfully!');
        setLink('');
        setShowModal(false);
        // Reload links to show the new one
        await loadLinks();
      } else {
        setError(data.error || 'Failed to add link');
      }
    } catch (err) {
      setError(`Cannot connect to server. Make sure the backend is running on port 4042.`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this link?')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/links/${id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Reload links
        await loadLinks();
      } else {
        alert(data.error || 'Failed to delete link');
      }
    } catch (err) {
      console.error('Error deleting link:', err);
      alert('Failed to delete link');
    }
  };

  if (loadingLinks) {
    return (
      <div className="App">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading links...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="app-header">
        <h1>Facebook Links</h1>
        <button 
          className="add-link-button"
          onClick={() => setShowModal(true)}
        >
          + Add Link
        </button>
      </header>

      <main className="main-content">
        {links.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <h2>No links yet</h2>
            <p>Add your first Facebook link to get started</p>
            <button 
              className="empty-button"
              onClick={() => setShowModal(true)}
            >
              Add Your First Link
            </button>
          </div>
        ) : (
          <div className="links-grid">
            {links.map((linkItem) => (
              <div key={linkItem.id} className="link-card">
                <button
                  className="delete-button"
                  onClick={() => handleDelete(linkItem.id)}
                  aria-label="Delete link"
                >
                  ×
                </button>

                {linkItem.imageUrl ? (
                  <div className="card-image-container">
                    <img
                      src={linkItem.imageUrl}
                      alt="Facebook post"
                      className="card-image"
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
                    <span>No image</span>
                  </div>
                )}

                <div className="card-info">
                  <div className="likes-section">
                    <span className="likes-icon">❤️</span>
                    <span className="likes-number">{linkItem.likesCount?.toLocaleString() || 0}</span>
                    <span className="likes-label">likes</span>
                  </div>

                  <a
                    href={linkItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-url"
                    title={linkItem.url}
                  >
                    View on Facebook →
                  </a>

                  <div className="link-date">
                    Added: {new Date(linkItem.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add Link Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setShowModal(false)}
            >
              ×
            </button>
            <h2>Add Facebook Link</h2>
            <p className="modal-subtitle">Enter a Facebook post or page URL</p>
            
            <form onSubmit={handleSubmit} className="add-link-form">
              <div className="input-group">
                <label htmlFor="facebookLink">Facebook Link</label>
                <input
                  type="url"
                  id="facebookLink"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://www.facebook.com/photo?fbid=..."
                  required
                  disabled={loading}
                  className="link-input"
                />
              </div>

              {error && <div className="error-message">{error}</div>}
              {success && <div className="success-message">{success}</div>}

              <button
                type="submit"
                disabled={loading || !link.trim()}
                className="submit-button"
              >
                {loading ? 'Adding...' : 'Add Link'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
