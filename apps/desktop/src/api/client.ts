import axios from 'axios';
import { ElMessage } from 'element-plus';

/** 服务端地址：默认本地开发；生产可在设置页修改（存 localStorage） */
const BASE_URL = localStorage.getItem('apiBaseUrl') ?? 'http://localhost:3000/api';

export const http = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (resp) => resp.data,
  (error) => {
    const status = error.response?.status;
    const msg = error.response?.data?.message ?? error.message ?? '网络错误';
    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // 避免登录页循环弹窗
      if (!location.hash.includes('/login')) {
        ElMessage.error('登录已过期，请重新登录');
        location.hash = '#/login';
      }
    } else {
      ElMessage.error(Array.isArray(msg) ? msg.join('；') : String(msg));
    }
    return Promise.reject(error);
  },
);

export function setApiBaseUrl(url: string) {
  localStorage.setItem('apiBaseUrl', url.replace(/\/$/, ''));
}

export function getApiBaseUrl(): string {
  return localStorage.getItem('apiBaseUrl') ?? 'http://localhost:3000/api';
}
