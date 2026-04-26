import { Link, useParams } from 'react-router-dom'

export default function WorkspaceHome() {
  const { workspaceId } = useParams()
  const base = `/w/${workspaceId}`
  const cards = [
    { to: `${base}/contacts`, title: 'Contacts', desc: 'WhatsApp contacts and notes' },
    { to: `${base}/chats`, title: 'Chats', desc: 'View conversations and send WhatsApp messages' },
    { to: `${base}/templates`, title: 'Templates', desc: 'Reusable message bodies' },
    { to: `${base}/automations`, title: 'Automations', desc: 'Flows with GPT-powered branches' },
    { to: `${base}/whatsapp`, title: 'WhatsApp', desc: 'Pair this workspace with QR' },
    { to: `${base}/logs`, title: 'Message log', desc: 'Inbound and outbound audit trail' },
  ]
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Workspace</h1>
        <p className="mt-1 font-mono text-xs text-slate-500">{workspaceId}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.to}>
            <Link
              to={c.to}
              className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-cyan-500/30 dark:border-slate-800 dark:bg-slate-900/50"
            >
              <h2 className="font-medium text-cyan-600 dark:text-cyan-300">{c.title}</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{c.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
