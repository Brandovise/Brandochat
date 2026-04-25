type Props = { title: string; description?: string }

export function PageHeader({ title, description }: Props) {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{title}</h1>
      {description ? <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p> : null}
    </header>
  )
}
