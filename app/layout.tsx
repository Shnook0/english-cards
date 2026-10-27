import type { Metadata, Viewport } from 'next'
import { SerwistProvider } from '@serwist/turbopack/react'
import './globals.css'
import OfflineNavigationGuard from '@/components/OfflineNavigationGuard'
import OfflineRouteCache from '@/components/OfflineRouteCache'
import ScrollRestorer from '@/components/ScrollRestorer'
import SyncProvider from '@/components/SyncProvider'

export const metadata: Metadata = {
  title: 'English Cards — личный лексикон',
  description: 'Тихий, продуманный тренажёр английских слов',
  applicationName: 'English Cards',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'English Cards',
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  themeColor: '#0d0d10',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body className="bg-[#0d0d10] text-[#ececf1] min-h-screen font-sans antialiased">
        <SerwistProvider
          swUrl="/serwist/sw.js"
          cacheOnNavigation={true}
          reloadOnOnline={false}
        >
          <OfflineNavigationGuard />
          <OfflineRouteCache />
          <ScrollRestorer />
          <SyncProvider />
          {children}
        </SerwistProvider>
      </body>
    </html>
  )
}