import axios from 'axios';
import { API_URL } from '../providers/axios';

// The employees' app keeps its own sign-in, separate from the HR app's
// (hr_token) — the two are different accounts, and the HR pages are closed to
// an employee account anyway.
const TOKEN_KEY = 'me_token';
const USER_KEY = 'me_user';

export interface MeUser {
  id: string;
  role: string;
  employee: { _id: string; employeeCode?: string; firstName?: string; lastName?: string } | null;
}

export const meApi = axios.create({ baseURL: API_URL });

meApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onSignedOut: (() => void) | null = null;
export function whenSignedOut(handler: () => void) {
  onSignedOut = handler;
}

meApi.interceptors.response.use(
  (res) => res,
  (error) => {
    // Session ended (password reset by HR, account closed, token expired).
    if (error?.response?.status === 401 && localStorage.getItem(TOKEN_KEY)) {
      signOut();
    }
    return Promise.reject(error);
  }
);

export function savedUser(): MeUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw && localStorage.getItem(TOKEN_KEY) ? (JSON.parse(raw) as MeUser) : null;
  } catch {
    return null;
  }
}

export function signIn(token: string, user: MeUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  onSignedOut?.();
}

export const errorMessage = (err: any, fallback: string): string => err?.response?.data?.message || fallback;
