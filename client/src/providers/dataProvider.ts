import simpleRestDataProvider from '@refinedev/simple-rest';
import { API_URL, axiosInstance } from './axios';

export const dataProvider = simpleRestDataProvider(API_URL, axiosInstance);
