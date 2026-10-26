import React, { Component } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';
import App from './App.jsx';

class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Admin app rendering failed.', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-error" role="alert">
          <h1>Admin app could not load</h1>
          <p>{this.state.error.message || 'An unexpected rendering error occurred.'}</p>
          <p>Refresh the page. If this continues, share this error with your administrator.</p>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>,
);
