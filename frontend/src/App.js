import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate } from 'react-router-dom';
import './App.css';
import AddPost from './components/AddPost';
import PostPreview from './components/PostPreview';

function App() {
  return (
    <Router>
      <div className="App">
        <nav className="navbar">
          <div className="nav-container">
            <Link to="/" className="nav-logo">
              Facebook Votes
            </Link>
            <div className="nav-links">
              <Link to="/" className="nav-link">Add Post</Link>
              <Link to="/preview" className="nav-link">Preview</Link>
            </div>
          </div>
        </nav>
        <Routes>
          <Route path="/" element={<AddPost />} />
          <Route path="/preview" element={<PostPreview />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
