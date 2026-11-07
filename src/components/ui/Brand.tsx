import { Link } from 'react-router-dom';
import { Isotype, Badge } from '@caramelo/design-system';

/** Caramelo isotype + Claquete wordmark + badge oficial. */
export function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/projects" className="brand" title="Projetos" aria-label="Claquete — projetos">
      <Isotype size={24} decorative interactive />
      {!compact && (
        <span className="brand-label">
          <span className="brand-name">Claquete</span>
          <Badge color="caramel" variant="outline" size="sm" className="brand-badge">
            CINEMA COM IA
          </Badge>
        </span>
      )}
    </Link>
  );
}
