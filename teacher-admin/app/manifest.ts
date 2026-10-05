import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '考吧167｜申论 × 面试｜上岸训练系统',
    short_name: '考吧167',
    description: '做题、批改、复盘、再练，一题三轮看见进步。',
    start_url: '/student',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f8fb',
    theme_color: '#173857',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
