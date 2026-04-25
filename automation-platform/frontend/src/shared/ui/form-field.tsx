import type { ReactNode } from 'react'

type Props = {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}

export function FormField({ label, hint, className = '', children }: Props) {
  return (
    <label className={`block text-sm ${className}`.trim()}>
      <span className="text-slate-600 dark:text-slate-400">{label}</span>
      {hint ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-500">{hint}</p> : null}
      <div className="mt-1">{children}</div>
    </label>
  )
}
