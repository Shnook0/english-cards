import type { Metadata, Viewport } from 'next'
import { SerwistProvider } from '@serwist/turbopack/react'
import './globals.css'
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
  themeColor: '#090909',
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
      <body className="bg-[#090909] text-[#f2eee5] min-h-screen font-sans antialiased">
        <SerwistProvider
          swUrl="/serwist/sw.js"
          cacheOnNavigation={false}
          reloadOnOnline={false}
        >
          <ScrollRestorer />
          <SyncProvider />
          {children}
        </SerwistProvider>
      </body>
    </html>
  )
}