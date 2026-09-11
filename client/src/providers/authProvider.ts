import type { AuthProvider } from '@refinedev/core';
import { API_URL, axiosInstance } from './axios';
import type { Identity } from '../types';

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    try {
      const { data } = await axiosInstance.post(`${API_URL}/auth/login`, { email, password });
      localStorage.setItem('hr_token', data.token);
      localStorage.setItem('hr_identity', JSON.stringify(data.user));
      return { success: true, redirectTo: '/' };
    } catch (err: any) {
      return {
        success: false,
        error: {
          name: 'LoginError',
          message: err?.response?.data?.message || 'ອີເມວ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ',
        },
      };
    }
  },
  logout: async () => {
    localStorage.removeItem('hr_token');
    localStorage.removeItem('hr_identity');
    return { success: true, redirectTo: '/login' };
  },
  check: async () => {
    const token = localStorage.getItem('hr_token');
    if (!token) return { authenticated: false, redirectTo: '/login' };
    return { authenticated: true };
  },
  onError: async (error) => {
    if (error?.response?.status === 401) {
      return { logout: true, redirectTo: '/login' };
    }
    return { error };
  },
  getIdentity: async (): Promise<Identity | null> => {
    const raw = localStorage.getItem('hr_identity');
    return raw ? JSON.parse(raw) : null;
  },
  getPermissions: async () => {
    const raw = localStorage.getItem('hr_identity');
    if (!raw) return null;
    return (JSON.parse(raw) as Identity).role;
  },
};
