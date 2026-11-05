'use client'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
}

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Поиск слов…',
  label = 'Поиск',
}: Props) {
  return (
    <div className="relative mb-3">
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="field w-full"
        autoComplete="off"
      />
    </div>
  )
}

export function matchesQuery(query: string, ...fields: Array<string | string[] | null | undefined>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some(field => {
    if (!field) return false
    const text = Array.isArray(field) ? field.join(' ') : field
    return text.toLowerCase().includes(q)
  })
}
