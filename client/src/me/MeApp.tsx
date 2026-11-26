import { useEffect, useState } from 'react';
import { IonApp } from '@ionic/react';
import { meApi, savedUser, shareSession, whenSignedOut, type MeUser } from './api';
import { keepStorage } from './lib/queue';
import { SignInPage } from './pages/SignInPage';
import { Shell } from './pages/Shell';

// The employees' own app (/me) — separate from the HR app: an employee
// account can reach nothing else (server: middleware/auth.js).
export const MeApp: React.FC = () => {
  const [user, setUser] = useState<MeUser | null>(() => savedUser());

  useEffect(() => {
    whenSignedOut(() => setUser(null));
    // Confirms the saved session still holds (HR may have reset the password).
    if (savedUser()) {
      shareSession();
      meApi.get('/auth/me').catch(() => undefined);
    }
    keepStorage();
  }, []);

  return <IonApp>{user ? <Shell user={user} /> : <SignInPage onSignedIn={() => setUser(savedUser())} />}</IonApp>;
};
