/** 服务端 HTTP 访问：统一携带 Token、处理 401 与错误提示 */

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export function getApiBase(): string {
  return (uni.getStorageSync('apiBase') as string) || 'http://localhost:3000/api';
}

export function setApiBase(url: string) {
  uni.setStorageSync('apiBase', url.replace(/\/$/, ''));
}

export function getToken(): string {
  return (uni.getStorageSync('token') as string) || '';
}

export function getUser(): { id: string; name: string; role: string } | null {
  try {
    return JSON.parse((uni.getStorageSync('user') as string) || 'null');
  } catch {
    return null;
  }
}

export function logout() {
  uni.removeStorageSync('token');
  uni.removeStorageSync('user');
}

export function http<T = unknown>(method: Method, path: string, data?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: getApiBase() + path,
      method: method as never,
      data: data as never,
      header: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      success: (res) => {
        const status = res.statusCode ?? 0;
        if (status === 401) {
          logout();
          uni.reLaunch({ url: '/pages/login/login' });
          reject(new Error('登录已过期'));
          return;
        }
        if (status >= 200 && status < 300) {
          resolve(res.data as T);
          return;
        }
        const body = res.data as { message?: unknown } | undefined;
        const msg = Array.isArray(body?.message)
          ? (body!.message as string[]).join('；')
          : body?.message ?? `请求失败（${status}）`;
        uni.showToast({ title: String(msg), icon: 'none' });
        reject(new Error(String(msg)));
      },
      fail: (err) => {
        uni.showToast({ title: '网络错误，请检查服务器地址', icon: 'none' });
        reject(err);
      },
    });
  });
}
