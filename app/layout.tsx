import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'English Cards',
  description: 'Тренажёр английских слов',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body className="bg-[#0f1115] text-[#e6e8ec] min-h-screen font-sans antialiased">
        {children}
      </body>
    </html>
  )
}