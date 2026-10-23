import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('@/views/LayoutView.vue'),
      children: [
        { path: '', redirect: '/register' },
        { path: 'register', name: 'register', component: () => import('@/views/RegisterView.vue') },
        { path: 'products', name: 'products', component: () => import('@/views/ProductsView.vue'), meta: { bossOnly: true } },
        { path: 'inventory', name: 'inventory', component: () => import('@/views/InventoryView.vue') },
        { path: 'refund', name: 'refund', component: () => import('@/views/RefundView.vue') },
        { path: 'shift', name: 'shift', component: () => import('@/views/ShiftView.vue') },
        { path: 'orders', name: 'orders', component: () => import('@/views/OrdersView.vue') },
        { path: 'reports', name: 'reports', component: () => import('@/views/ReportsView.vue'), meta: { bossOnly: true } },
        { path: 'users', name: 'users', component: () => import('@/views/UsersView.vue'), meta: { bossOnly: true } },
        { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') ?? 'null') as { role?: string } | null;
  if (!to.meta.public && !token) return { name: 'login' };
  if (to.meta.bossOnly && user?.role !== 'BOSS') return { name: 'register' };
  if (to.name === 'login' && token) return { name: 'register' };
  return true;
});

export default router;
