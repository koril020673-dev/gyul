import './globals.css';
import { config } from '@/lib/config';

export const metadata = {
  title: `${config.farmName} 감귤 주문`,
  description: '제주 감귤 주문서',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
