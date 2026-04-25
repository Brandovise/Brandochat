import type { InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement>

export function TextInput({ className = '', ...props }: Props) {
  return (
    <input
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-emerald-500/50 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white ${className}`.trim()}
      {...props}
    />
  )
}
