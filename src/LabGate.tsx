import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { activateLabUser } from './lib/labAccess';

type Access = { kind: 'loading' | 'signed_out' | 'locked' | 'error' } | { kind: 'ready'; userId: string };

function expiresAt(session: Session): number {
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : 0;
  } catch { return 0; }
}

/** Protects both direct visits and the LAB iframe before any project UI mounts. */
export function LabGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let alive = true, version = 0;
    let readyToken: string | null = null;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    const block = (kind: 'signed_out' | 'locked' | 'error') => {
      ++version;
      readyToken = null;
      clearTimeout(expiry);
      activateLabUser(null);
      if (alive) setAccess({ kind });
    };
    const validate = async (session: Session | null) => {
      const request = ++version;
      if (!session?.access_token || !session.user?.id) { block('signed_out'); return; }
      if (session.access_token !== readyToken) { activateLabUser(null); setAccess({ kind: 'loading' }); }
      const auth = await supabase.auth.getUser(session.access_token).catch(() => null);
      if (!alive || request !== version) return;
      const verified = auth?.data.user;
      const deadline = expiresAt(session);
      if (!auth || auth.error || !verified || verified.is_anonymous || verified.id !== session.user.id || deadline <= Date.now()) { block('signed_out'); return; }
      clearTimeout(expiry);
      expiry = setTimeout(() => block('signed_out'), Math.min(deadline - Date.now(), 2_147_000_000));
      const result = await supabase.rpc('has_tool', { p_slug: 'claquete' }).then((r) => r, () => null);
      if (!alive || request !== version) return;
      if (deadline <= Date.now()) { block('signed_out'); return; }
      if (!result || result.error) { block('error'); return; }
      if (result.data !== true) { block('locked'); return; }
      readyToken = session.access_token;
      activateLabUser(verified.id);
      setAccess({ kind: 'ready', userId: verified.id });
    };
    const refresh = () => {
      const request = ++version;
      void supabase.auth.getSession().then(({ data, error }) => {
        if (!alive || request !== version) return;
        if (error) block('signed_out');
        else void validate(data.session);
      }).catch(() => { if (alive && request === version) block('error'); });
    };
    refresh();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      clearTimeout(authTimer);
      if (event === 'SIGNED_OUT' || !session) { block('signed_out'); return; }
      const request = ++version;
      if (session.access_token !== readyToken) { activateLabUser(null); setAccess({ kind: 'loading' }); }
      authTimer = setTimeout(() => { if (alive && request === version) void validate(session); }, 0);
    });
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(onVisible, 60_000);
    return () => {
      alive = false; ++version; activateLabUser(null);
      clearTimeout(expiry); clearTimeout(authTimer); clearInterval(poll);
      data.subscription.unsubscribe();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [attempt]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setFeedback('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setFeedback('Não foi possível entrar. Confira seu e-mail e senha.');
    } catch { setFeedback('Não foi possível entrar agora. Tente novamente.'); }
    finally { setSubmitting(false); }
  };

  if (access.kind === 'ready') return <div key={access.userId} style={{ height: '100%' }}>{children}</div>;
  return (
    <main className="empty-state" style={{ minHeight: '100dvh', padding: 24 }}>
      <section className="cm-surface" style={{ maxWidth: 440, width: '100%', padding: 32 }} aria-busy={access.kind === 'loading'}>
        <h1 style={{ fontSize: 26, marginBottom: 16 }}>Claquete — LAB</h1>
        {access.kind === 'loading' ? <p role="status">Conferindo seu acesso…</p> : null}
        {access.kind === 'signed_out' ? <>
          <p>Entre com sua conta do LAB para usar o Claquete.</p>
          <form onSubmit={signIn} style={{ display: 'grid', gap: 16, marginTop: 24 }}>
            <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
            <label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
            {feedback ? <p role="alert">{feedback}</p> : null}
            <button className="btn" type="submit" disabled={submitting}>{submitting ? 'Entrando…' : 'Entrar'}</button>
          </form>
        </> : null}
        {access.kind === 'locked' ? <p>O Claquete precisa estar na sua biblioteca para ser aberto.</p> : null}
        {access.kind === 'error' ? <><p>Não foi possível conferir seu acesso.</p><button className="btn" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button></> : null}
        <a href="https://umcaracaramelo.com.br/library/home" target="_top" style={{ display: 'inline-block', marginTop: 24 }}>Ir para o LAB ↗</a>
      </section>
    </main>
  );
}
