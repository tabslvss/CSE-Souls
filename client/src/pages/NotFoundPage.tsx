import { Link } from 'react-router-dom';
import { Vignette } from '../scene/Vignette';

export function NotFoundPage() {
  return (
    <div className="page lost">
      <Vignette kind="lost" art="lost" className="lost__art" />
      <h1>Page not found</h1>
      <p className="lede">This page doesn't exist.</p>
      <Link className="btn" to="/">Back to Home</Link>
    </div>
  );
}
