import type { Metadata } from 'next'
import './globals.css'
import ScrollRestorer from '@/components/ScrollRestorer'

export const metadata: Metadata = {
  title: 'English Cards — личный лексикон',
  description: 'Тихий, продуманный тренажёр английских слов',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body className="bg-[#090909] text-[#f2eee5] min-h-screen font-sans antialiased">
        <ScrollRestorer />
        {children}
      </body>
    </html>
  )
}