import './globals.css';
import './kaoba.css';
import './student.css';
import Pwa from '../components/Pwa';
export const metadata = {
  title: '考吧167｜申论 × 面试｜上岸训练系统',
  description: '每一次练习，都离上岸更近一步。做题、批改、复盘、再练。',
  icons: { icon: '/brand/logo-icon.svg', apple: '/brand/icon-192.png' },
  appleWebApp: { capable: true, title: '考吧167', statusBarStyle: 'default' },
};
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#173857',
  viewportFit: 'cover',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <Pwa />
      </body>
    </html>
  );
}
