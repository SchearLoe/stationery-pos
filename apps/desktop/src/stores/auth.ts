import { defineStore } from 'pinia';
import { login as apiLogin } from '@/api';
import type { AuthUser } from '@pos/shared-types';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') ?? '',
    user: JSON.parse(localStorage.getItem('user') ?? 'null') as AuthUser | null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token && !!s.user,
    isBoss: (s) => s.user?.role === 'BOSS',
    userName: (s) => s.user?.name ?? s.user?.username ?? '',
  },
  actions: {
    async login(username: string, password: string) {
      const result = await apiLogin(username, password);
      this.token = result.accessToken;
      this.user = result.user;
      localStorage.setItem('token', result.accessToken);
      localStorage.setItem('user', JSON.stringify(result.user));
    },
    /** 老板授权：验证一个 BOSS 账号，成功返回其姓名 */
    async authorizeBoss(username: string, password: string): Promise<string> {
      const result = await apiLogin(username, password);
      if (result.user.role !== 'BOSS') throw new Error('该账号不是老板账号');
      return result.user.name;
    },
    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    },
  },
});
