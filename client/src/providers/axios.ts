import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || '/api';

export const resolvePhotoUrl = (photoUrl?: string | null) => (photoUrl ? `${API_URL}${photoUrl}` : undefined);

export const axiosInstance = axios.create();

axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem('hr_token');
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem('hr_token');
      localStorage.removeItem('hr_identity');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    // Surface the API's own error message (e.g. delete-protection, head-conflict
    // validation) into what refine's notification provider actually displays —
    // without this, mutation failures show axios's generic "Request failed with
    // status code 409" instead of the real reason.
    if (error?.response?.data?.message) {
      error.message = error.response.data.message;
    }
    // @refinedev/simple-rest's error notifications read `error.statusCode`
    // (its own internal axios instance sets this) — since we pass our own
    // axiosInstance in instead, that field was never being set, so every
    // edit/create/delete error notification showed "(ລະຫັດ: )" with no code.
    error.statusCode = error?.response?.status;
    return Promise.reject(error);
  }
);
