type Props = { message: string | null }

export function FormError({ message }: Props) {
  if (!message) return null
  return <p className="text-sm text-rose-600 dark:text-red-400">{message}</p>
}
