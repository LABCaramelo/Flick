import { Link } from 'react-router-dom';

/** Clapperboard mark + wordmark. */
export function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/projects" className="brand" title="Projetos">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <path d="M5 13h22v13H5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5 13l2.2-6.2 19.6 0L24.6 13" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M11 7l-2.6 6M17 7l-2.6 6M23 7l-2.6 6" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="23" cy="19.5" r="2.4" fill="#F9634E" />
      </svg>
      {!compact && <span>CLAQUETE</span>}
    </Link>
  );
}
