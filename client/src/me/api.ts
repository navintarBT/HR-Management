import axios from 'axios';
import { API_URL } from '../providers/axios';
import { requestFailed, requestWorked } from './lib/connection';
import { dropSession, keepSession } from './lib/session';

// The employees' app keeps its own sign-in, separate from the HR app's
// (hr_token) — the two are different accounts, and the HR pages are closed to
// an employee account anyway.
const TOKEN_KEY = 'me_token';
const USER_KEY = 'me_user';

export interface MeUser {
  id: string;
  role: string;
  username?: string;
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
  (res) => {
    requestWorked();
    // Signed in until signing out: the server swaps in a fresh token while the
    // app is in use (server: utils/tokens.js).
    const renewed = res.headers?.['x-renewed-token'];
    if (renewed && localStorage.getItem(TOKEN_KEY)) {
      localStorage.setItem(TOKEN_KEY, renewed);
      shareSession();
    }
    return res;
  },
  (error) => {
    // No answer at all (no internet, or none in time), or the host answering
    // for a server that's restarting.
    const status = error?.response?.status;
    if (!axios.isCancel(error)) {
      if (!error?.response || (status >= 502 && status <= 504)) requestFailed();
      else requestWorked();
    }
    // Session ended (password reset by HR, account closed, token expired).
    if (status === 401 && localStorage.getItem(TOKEN_KEY)) {
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

// What the service worker sends waiting photos with while the app is closed.
export function shareSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const owner = savedUser()?.employee?._id;
  if (token && owner) keepSession({ token, owner, api: new URL(API_URL, window.location.href).href });
}

export function signIn(token: string, user: MeUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  shareSession();
}

export function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  dropSession();
  onSignedOut?.();
}

export const errorMessage = (err: any, fallback: string): string => err?.response?.data?.message || fallback;
