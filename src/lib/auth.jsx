import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { COLLECTIONS } from './collections';

// Roles:
//   'admin'  — can read everything and create / edit / delete.
//   'viewer' — can read everything, no changes.
//   'none'   — signed in, but not yet authorised (no userRoles doc).
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fires on sign-in, sign-out, and once on page load.
    return onAuthStateChanged(auth, async (signedInUser) => {
      setUser(signedInUser);
      if (signedInUser?.email) {
        try {
          const snap = await getDoc(
            doc(db, COLLECTIONS.USER_ROLES, signedInUser.email.toLowerCase())
          );
          setRole(snap.exists() ? snap.data().role : 'none');
        } catch {
          setRole('none');
        }
      } else {
        setRole(null);
      }
      setLoading(false);
    });
  }, []);

  const value = {
    user,
    role,
    loading,
    isAdmin: role === 'admin',
    canUse: role === 'admin' || role === 'viewer',
    login: (email, password) =>
      signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password),
    logout: () => signOut(auth),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook used anywhere in the app to read the current user and role.
export function useAuth() {
  return useContext(AuthContext);
}
