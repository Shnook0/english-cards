'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Icon, { type IconName } from '@/components/ui/Icon'

const TABS: { href: string; label: string; icon: IconName; match: (path: string) => boolean }[] = [
  { href: '/', label: 'Главная', icon: 'home', match: p => p === '/' || p.startsWith('/favorites') },
  {
    href: '/folders',
    label: 'Папки',
    icon: 'folder',
    match: p => p.startsWith('/folders') || p.startsWith('/folder/') || p.startsWith('/levels'),
  },
  { href: '/general', label: 'Тренировка', icon: 'spark', match: p => p.startsWith('/general') },
  { href: '/mistakes', label: 'Ошибки', icon: 'target', match: p => p.startsWith('/mistakes') },
  { href: '/settings', label: 'Настройки', icon: 'settings', match: p => p.startsWith('/settings') },
]

// На входе и во время тренировки панель не нужна — экран целиком отдан карточке.
function isHidden(path: string): boolean {
  return (
    path.startsWith('/login') ||
    path.startsWith('/reset-password') ||
    path.includes('/train') ||
    path.endsWith('/repeat') ||
    path.includes('/play/')
  )
}

export default function AppNav() {
  const pathname = usePathname() ?? '/'
  if (isHidden(pathname)) return null

  return (
    <>
      <div aria-hidden="true" className="tabbar-spacer" />
      <nav className="tabbar" aria-label="Разделы">
        {TABS.map(tab => {
          const active = tab.match(pathname)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`tabbar-item ${active ? 'tabbar-item-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon name={tab.icon} size={22} />
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
