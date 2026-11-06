import { Component, type ReactNode } from 'react';

/** Shows a way forward if something breaks while drawing a page, instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page center">
        <h1>Something went wrong</h1>
        <p className="lede">Try going back to the home page.</p>
        <a className="btn" href="/">Back to Home</a>
      </div>
    );
  }
}
