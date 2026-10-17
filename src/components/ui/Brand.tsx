import { Link } from 'react-router-dom';
import { Isotype } from './caramelo/Isotype';

/** Caramelo isotype + Claquete wordmark. */
export function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/projects" className="brand" title="Projetos" aria-label="Claquete — projetos">
      <Isotype size={26} decorative interactive />
      {!compact && <span>Claquete</span>}
    </Link>
  );
}
