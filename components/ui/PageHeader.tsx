import Link from 'next/link'
import Icon from '@/components/ui/Icon'

// Единая шапка экрана: «назад», заголовок и короткое пояснение, что здесь делать.
export default function PageHeader({
  back,
  title,
  description,
  actions,
}: {
  back?: { href: string; label: string }
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="mb-6">
      {back && (
        <Link href={back.href} className="back-link">
          <Icon name="arrowLeft" size={18} />
          {back.label}
        </Link>
      )}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  )
}
