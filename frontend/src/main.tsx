import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useSession } from './auth/useSession';
import { LoginView } from './auth/LoginView';
import { DashboardView } from './dashboard/DashboardView';
import './styles.css';

function App() {
  const auth = useSession();
  if (auth.loading)
    return (
      <main className="grid min-h-svh place-items-center text-sm text-muted-foreground" role="status">
        Conectando ao Aqua…
      </main>
    );
  if (!auth.session) return <LoginView login={auth.login} initialError={auth.error} />;
  return <DashboardView session={auth.session} logout={auth.logout} expired={auth.expired} />;
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
