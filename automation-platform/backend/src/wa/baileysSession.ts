import makeWASocket, {
  ALL_WA_PATCH_NAMES,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidNewsletter,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type CacheStore,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import pino from 'pino'
import path from 'node:path'
import fs from 'node:fs/promises'
import qrcodeTerminal from 'qrcode-terminal'
import { env } from '../config/env.js'
import { getServiceRoleClient } from '../lib/supabase-clients.js'
import { importHistorySyncBatch, upsertHistoryChats, upsertHistoryContacts } from './historySync.js'
import { handleInboundText } from './inboundPipeline.js'
import { restoreSessionAuthDirIfAvailable, scheduleSessionBackup } from './sessionBackup.js'

const logger = pino({ level: 'warn' })
const msgRetryCounterCache = new NodeCache() as CacheStore
const RECONNECT_DELAY_MS = 1_500
const SYNC_CONNECT_TIMEOUT_MS = 20_000
const SEND_CONNECT_TIMEOUT_MS = 20_000

type PairingStatus = 'disconnected' | 'qr' | 'connected' | 'error'

type SyncSnapshot = {
  state: 'idle' | 'syncing' | 'error'
  startedAt?: string
  lastBatchAt?: string
  lastFinishedAt?: string
  progress?: number | null
  syncType?: number | null
  batches: number
  chats: number
  contacts: number
  messages: number
  lastBatch?: {
    chats: number
    contacts: number
    messages: number
    isLatest?: boolean
  }
  lastError?: string
}

type SessionEntry = {
  workspaceId: string
  instanceId: string
  sock: WASocket | null
  pairing_status: PairingStatus
  qr?: string
  lastError?: string
  phoneLabel?: string
  starting: boolean
  sync: SyncSnapshot
}

const sessions = new Map<string, SessionEntry>()

function emptySyncSnapshot(): SyncSnapshot {
  return {
    state: 'idle',
    batches: 0,
    chats: 0,
    contacts: 0,
    messages: 0,
  }
}

function authDir(instanceId: string) {
  return path.join(env.WA_AUTH_ROOT, instanceId)
}

async function isAuthDirEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    return entries.length === 0
  } catch {
    return true
  }
}

async function upsertInstance(
  instanceId: string,
  patch: Partial<{
    pairing_status: PairingStatus
    last_error: string | null
    phone_label: string | null
    last_connected_at: string
  }>,
) {
  const admin = getServiceRoleClient()
  await admin
    .from('whatsapp_instances')
    .update({
      updated_at: new Date().toISOString(),
      ...patch,
    })
    .eq('id', instanceId)
}

async function loadInstanceSettings(instanceId: string): Promise<Record<string, unknown>> {
  const admin = getServiceRoleClient()
  const { data } = await admin.from('whatsapp_instances').select('settings').eq('id', instanceId).maybeSingle()
  const settings = data?.settings
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
}

function unwrapMessage(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null
  const m = message as Record<string, unknown>
  const wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage'] as const
  for (const key of wrappers) {
    const wrapped = m[key] as { message?: unknown } | undefined
    if (wrapped?.message) return unwrapMessage(wrapped.message)
  }
  return m
}

function extractText(msg: Record<string, unknown>): string | null {
  const m = unwrapMessage(msg.message)
  if (!m) return null
  if (typeof m.conversation === 'string') return m.conversation
  const ext = m.extendedTextMessage as { text?: string } | undefined
  if (ext?.text) return ext.text
  const image = m.imageMessage as { caption?: string } | undefined
  if (image?.caption) return image.caption
  const video = m.videoMessage as { caption?: string } | undefined
  if (video?.caption) return video.caption
  const document = m.documentMessage as { caption?: string } | undefined
  if (document?.caption) return document.caption
  const buttonsResponse = m.buttonsResponseMessage as { selectedDisplayText?: string; selectedButtonId?: string } | undefined
  if (buttonsResponse?.selectedDisplayText || buttonsResponse?.selectedButtonId) return buttonsResponse.selectedDisplayText ?? buttonsResponse.selectedButtonId ?? null
  const listResponse = m.listResponseMessage as { title?: string; singleSelectReply?: { selectedRowId?: string } } | undefined
  if (listResponse?.title || listResponse?.singleSelectReply?.selectedRowId) return listResponse.title ?? listResponse.singleSelectReply?.selectedRowId ?? null
  return null
}

function phoneE164FromJid(jid?: string | null): string | null {
  if (!jid?.endsWith('@s.whatsapp.net')) return null
  const phone = jid.split('@')[0]?.replace(/\D/g, '')
  return phone ? `+${phone}` : null
}

function resolveInboundAddress(message: WAMessage): {
  chatJid: string | null
  alternateJid?: string
  phoneE164?: string | null
  participantJid?: string
  participantAltJid?: string
} {
  const remoteJid = message.key.remoteJid ? jidNormalizedUser(message.key.remoteJid) : null
  const remoteJidAlt = message.key.remoteJidAlt ? jidNormalizedUser(message.key.remoteJidAlt) : null
  const participant = message.key.participant ? jidNormalizedUser(message.key.participant) : null
  const participantAlt = message.key.participantAlt ? jidNormalizedUser(message.key.participantAlt) : null

  if (remoteJid === 'status@broadcast' || (remoteJid && isJidNewsletter(remoteJid))) {
    return { chatJid: remoteJid }
  }

  if (remoteJid?.endsWith('@g.us')) {
    const participantPhoneJid = [participantAlt, participant].find((jid) => jid?.endsWith('@s.whatsapp.net'))
    const participantLidJid = [participant, participantAlt].find((jid) => jid?.endsWith('@lid'))
    return {
      chatJid: remoteJid,
      alternateJid: participantLidJid && participantLidJid !== remoteJid ? participantLidJid : undefined,
      phoneE164: null,
      participantJid: participantPhoneJid ?? participant ?? undefined,
      participantAltJid: participantLidJid && participantLidJid !== participantPhoneJid ? participantLidJid : undefined,
    }
  }

  const candidates = [remoteJidAlt, participantAlt, remoteJid, participant].filter(Boolean) as string[]
  const phoneJid = candidates.find((jid) => jid.endsWith('@s.whatsapp.net'))
  const lidJid = candidates.find((jid) => jid.endsWith('@lid'))
  const chatJid = phoneJid ?? remoteJid ?? participant ?? null
  return {
    chatJid,
    alternateJid: lidJid && lidJid !== chatJid ? lidJid : undefined,
    phoneE164: phoneE164FromJid(phoneJid ?? chatJid),
    participantJid: participant ?? undefined,
    participantAltJid: participantAlt ?? undefined,
  }
}

function disconnectStatusCode(error: unknown): number | undefined {
  return (error as Boom | undefined)?.output?.statusCode
}

function scheduleReconnect(workspaceId: string, instanceId: string) {
  setTimeout(() => {
    void ensureWorkspaceSocket(workspaceId, instanceId).catch((error) => {
      const session = sessions.get(instanceId)
      if (session) {
        session.pairing_status = 'error'
        session.lastError = error instanceof Error ? error.message : String(error)
      }
    })
  }, RECONNECT_DELAY_MS)
}

function logSyncError(source: string, error: unknown) {
  logger.error({ err: error }, `WhatsApp ${source} sync failed`)
}

function triggerAppStateSync(instanceId: string, sock: WASocket) {
  const session = sessions.get(instanceId)
  if (session) {
    session.sync = {
      ...session.sync,
      state: 'syncing',
      startedAt: new Date().toISOString(),
      lastError: undefined,
    }
  }
  void sock.resyncAppState(ALL_WA_PATCH_NAMES, false).catch(async (error) => {
    const failed = sessions.get(instanceId)
    if (failed) {
      failed.sync = {
        ...failed.sync,
        state: 'error',
        lastError: error instanceof Error ? error.message : 'Automatic sync failed',
      }
    }
    logSyncError('app-state', error)
    await upsertInstance(instanceId, {
      last_error: error instanceof Error ? error.message : 'Automatic sync failed',
    })
  })
}

async function waitForConnected(instanceId: string, timeoutMs: number): Promise<SessionEntry | null> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const session = sessions.get(instanceId)
    if (session?.sock && session.pairing_status === 'connected') return session
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

export function getSession(instanceId: string): SessionEntry | undefined {
  return sessions.get(instanceId)
}

export function getQr(instanceId: string): string | undefined {
  return sessions.get(instanceId)?.qr
}

export async function restoreConnectedWhatsAppSessions(): Promise<void> {
  const admin = getServiceRoleClient()
  const { data, error } = await admin
    .from('whatsapp_instances')
    .select('id, workspace_id, display_name, pairing_status, last_connected_at')
    .in('pairing_status', ['connected', 'disconnected', 'qr'])
    .order('last_connected_at', { ascending: false })

  if (error) {
    logger.error({ err: error }, 'Failed to load WhatsApp sessions for restore')
    return
  }

  for (const instance of data ?? []) {
    const instanceId = instance.id as string
    const workspaceId = instance.workspace_id as string
    if (!instanceId || !workspaceId) continue
    void ensureWorkspaceSocket(workspaceId, instanceId)
      .then(() => {
        logger.warn(
          {
            instanceId,
            workspaceId,
            displayName: instance.display_name,
            pairingStatus: instance.pairing_status,
          },
          'Restored WhatsApp session listener',
        )
      })
      .catch(async (restoreError) => {
        logger.error({ err: restoreError, instanceId, workspaceId }, 'Failed to restore WhatsApp session listener')
        await upsertInstance(instanceId, {
          pairing_status: 'disconnected',
          last_error: restoreError instanceof Error ? restoreError.message : 'Failed to restore WhatsApp session',
        })
      })
  }
}

export async function sendWorkspaceTextMessage(args: {
  workspaceId: string
  instanceId?: string
  jid: string
  text: string
}): Promise<{ waMessageId: string | null }> {
  const admin = getServiceRoleClient()
  let session: SessionEntry | null | undefined = args.instanceId
    ? sessions.get(args.instanceId)
    : Array.from(sessions.values()).find((entry) => entry.workspaceId === args.workspaceId && entry.pairing_status === 'connected')

  if (args.instanceId && (!session?.sock || session.pairing_status !== 'connected')) {
    await ensureWorkspaceSocket(args.workspaceId, args.instanceId)
    session = await waitForConnected(args.instanceId, SEND_CONNECT_TIMEOUT_MS)
  }

  if (!session?.sock && !args.instanceId) {
    const { data: preferredInstances } = await admin
      .from('whatsapp_instances')
      .select('id, pairing_status')
      .eq('workspace_id', args.workspaceId)
      .in('pairing_status', ['connected', 'disconnected', 'qr'])
      .order('last_connected_at', { ascending: false })
      .limit(5)

    for (const candidate of preferredInstances ?? []) {
      const fallbackInstanceId = candidate.id as string | undefined
      if (!fallbackInstanceId) continue
      await ensureWorkspaceSocket(args.workspaceId, fallbackInstanceId)
      session = await waitForConnected(fallbackInstanceId, SEND_CONNECT_TIMEOUT_MS)
      if (session?.sock && session.pairing_status === 'connected') break
    }
  }

  if (!session?.sock) {
    throw new Error('WhatsApp is not connected for this workspace. Click Start / refresh, scan the QR if shown, then send again.')
  }

  const sent = await session.sock.sendMessage(args.jid, { text: args.text })
  return { waMessageId: sent?.key.id ?? null }
}

export async function requestWorkspaceHistorySync(workspaceId: string, instanceId: string): Promise<void> {
  await ensureWorkspaceSocket(workspaceId, instanceId)
  const session = await waitForConnected(instanceId, SYNC_CONNECT_TIMEOUT_MS)
  if (!session?.sock) {
    throw new Error('WhatsApp must be connected before syncing history. Click Start / refresh, scan the QR if shown, then try again.')
  }

  // Baileys full message history arrives from WhatsApp during connect/pairing.
  // Resyncing app-state collections is still useful for fresh chat/contact metadata.
  await session.sock.resyncAppState(ALL_WA_PATCH_NAMES, false)
}

function readHistoryCursor(raw: unknown): { key: WAMessageKey; timestamp: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const message = raw as { key?: unknown; messageTimestamp?: unknown }
  if (!message.key || typeof message.key !== 'object' || Array.isArray(message.key)) return null
  const key = message.key as WAMessageKey
  const ts = message.messageTimestamp
  const timestamp =
    typeof ts === 'number'
      ? ts
      : typeof ts === 'string'
        ? Number(ts)
        : typeof ts === 'object' && ts != null && 'low' in ts
          ? Number((ts as { low: number }).low)
          : undefined

  if (!key.remoteJid || !key.id || !timestamp || Number.isNaN(timestamp)) return null
  return { key, timestamp }
}

export async function requestChatHistorySync(args: {
  workspaceId: string
  instanceId: string
  contactJid: string
  count?: number
}): Promise<{ mode: 'requested'; requestedCount: number }> {
  await ensureWorkspaceSocket(args.workspaceId, args.instanceId)
  const session = await waitForConnected(args.instanceId, SYNC_CONNECT_TIMEOUT_MS)
  if (!session?.sock) {
    throw new Error('WhatsApp must be connected before syncing this chat. Click Start / refresh, scan the QR if shown, then try again.')
  }

  const admin = getServiceRoleClient()
  const { data: oldest, error } = await admin
    .from('message_events')
    .select('raw')
    .eq('workspace_id', args.workspaceId)
    .eq('wa_chat_jid', args.contactJid)
    .not('raw', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to find oldest chat message: ${error.message}`)

  const cursor = readHistoryCursor((oldest as { raw?: unknown } | null)?.raw)
  if (!cursor) {
    throw new Error(
      'No stored message cursor for this chat yet. Run Download chats & contacts once, then open the chat and try Sync this chat again.',
    )
  }

  const requestedCount = Math.min(args.count ?? 50, 50)
  await session.sock.fetchMessageHistory(requestedCount, cursor.key, cursor.timestamp)
  return { mode: 'requested', requestedCount }
}

export async function disconnectWorkspace(instanceId: string): Promise<void> {
  const s = sessions.get(instanceId)
  if (s?.sock) {
    try {
      s.sock.end(undefined)
    } catch {
      /* ignore */
    }
  }
  sessions.delete(instanceId)
  await fs.rm(authDir(instanceId), { recursive: true, force: true })
  await upsertInstance(instanceId, { pairing_status: 'disconnected', last_error: null })
}

export async function ensureWorkspaceSocket(workspaceId: string, instanceId: string): Promise<void> {
  const existing = sessions.get(instanceId)
  if (existing?.sock && existing.pairing_status === 'connected') return
  if (existing?.starting) return
  if (existing?.sock) {
    try {
      existing.sock.end(undefined)
    } catch {
      /* ignore */
    }
    existing.sock = null
  }
  if (!existing) {
    sessions.set(instanceId, {
      workspaceId,
      instanceId,
      sock: null,
      pairing_status: 'disconnected',
      starting: true,
      sync: emptySyncSnapshot(),
    })
  } else {
    existing.starting = true
  }

  const dir = authDir(instanceId)
  await fs.mkdir(dir, { recursive: true })
  if (await isAuthDirEmpty(dir)) {
    const restored = await restoreSessionAuthDirIfAvailable({ workspaceId, instanceId, authDir: dir }).catch(() => false)
    if (restored) {
      logger.warn({ instanceId, workspaceId }, 'Restored WhatsApp auth files from Supabase backup')
    }
  }

  const admin = getServiceRoleClient()
  const instanceSettings = await loadInstanceSettings(instanceId)
  const alwaysSyncHistory = instanceSettings.always_sync_history !== false
  const skipPhoneNotifications = instanceSettings.skip_phone_notifications === true
  const { state, saveCreds } = await useMultiFileAuthState(dir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger,
    browser: Browsers.macOS('Desktop'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache,
    syncFullHistory: alwaysSyncHistory,
    shouldSyncHistoryMessage: () => alwaysSyncHistory,
    // true => mark online and reduce phone push notifications while desktop/web is active
    markOnlineOnConnect: skipPhoneNotifications,
    getMessage: async () => undefined,
  })

  const entry = sessions.get(instanceId)!
  entry.sock = sock
  entry.starting = false

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    const cur = sessions.get(instanceId)
    if (!cur) return
    if (cur.sock !== sock) return
    if (qr) {
      cur.qr = qr
      cur.pairing_status = 'qr'
      qrcodeTerminal.generate(qr, { small: true })
      await upsertInstance(instanceId, { pairing_status: 'qr', last_error: null })
    }
    if (connection === 'open') {
      cur.pairing_status = 'connected'
      cur.qr = undefined
      cur.phoneLabel = sock.user?.id ?? undefined
      await upsertInstance(instanceId, {
        pairing_status: 'connected',
        last_error: null,
        phone_label: cur.phoneLabel ?? null,
        last_connected_at: new Date().toISOString(),
      })
      triggerAppStateSync(instanceId, sock)
      scheduleSessionBackup({ workspaceId, instanceId, authDir: dir })
    }
    if (connection === 'close') {
      const code = disconnectStatusCode(lastDisconnect?.error)
      const shouldReconnect = code !== DisconnectReason.loggedOut
      cur.pairing_status = shouldReconnect ? 'disconnected' : 'error'
      cur.qr = undefined
      cur.lastError = (lastDisconnect?.error as Boom | undefined)?.message ?? 'closed'
      await upsertInstance(instanceId, {
        pairing_status: shouldReconnect ? 'disconnected' : 'error',
        last_error: cur.lastError ?? null,
      })
      cur.sock = null
      cur.starting = false
      if (shouldReconnect) {
        sessions.delete(instanceId)
        scheduleReconnect(workspaceId, instanceId)
      } else {
        await fs.rm(authDir(instanceId), { recursive: true, force: true })
      }
    }
  })

  sock.ev.on('creds.update', async () => {
    await saveCreds()
    scheduleSessionBackup({ workspaceId, instanceId, authDir: dir })
  })

  sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest, progress, syncType }) => {
    const cur = sessions.get(instanceId)
    if (cur) {
      cur.sync = {
        ...cur.sync,
        state: isLatest ? 'idle' : 'syncing',
        startedAt: cur.sync.startedAt ?? new Date().toISOString(),
        lastBatchAt: new Date().toISOString(),
        lastFinishedAt: isLatest ? new Date().toISOString() : cur.sync.lastFinishedAt,
        progress,
        syncType,
        batches: cur.sync.batches + 1,
        chats: cur.sync.chats + chats.length,
        contacts: cur.sync.contacts + contacts.length,
        messages: cur.sync.messages + messages.length,
        lastBatch: {
          chats: chats.length,
          contacts: contacts.length,
          messages: messages.length,
          isLatest,
        },
        lastError: undefined,
      }
      logger.warn(
        {
          instanceId,
          chats: chats.length,
          contacts: contacts.length,
          messages: messages.length,
          progress,
          syncType,
          isLatest,
        },
        'WhatsApp history batch received',
      )
    }
    try {
      await importHistorySyncBatch({
        admin,
        workspaceId,
        instanceId,
        chats,
        contacts,
        messages,
      })
    } catch (error) {
      const failed = sessions.get(instanceId)
      if (failed) {
        failed.sync = {
          ...failed.sync,
          state: 'error',
          lastError: error instanceof Error ? error.message : 'History sync failed',
        }
      }
      logSyncError('history', error)
      await upsertInstance(instanceId, {
        last_error: error instanceof Error ? error.message : 'History sync failed',
      })
    }
  })

  sock.ev.on('contacts.upsert', async (contacts) => {
    try {
      await upsertHistoryContacts({ admin, workspaceId, instanceId }, contacts)
    } catch (error) {
      logSyncError('contacts', error)
    }
  })

  sock.ev.on('chats.upsert', async (chats) => {
    try {
      await upsertHistoryChats({ admin, workspaceId, instanceId }, chats)
    } catch (error) {
      logSyncError('chats', error)
    }
  })

  sock.ev.on('messages.upsert', async (upsert) => {
    logger.warn(
      {
        type: upsert.type,
        count: upsert.messages.length,
        jids: upsert.messages.map((message) => message.key?.remoteJid).filter(Boolean).slice(0, 5),
      },
      'WhatsApp messages upsert received',
    )
    if (upsert.type !== 'notify' && upsert.type !== 'append') return
    for (const msg of upsert.messages) {
      const address = resolveInboundAddress(msg)
      const jid = address.chatJid
      if (!jid || msg.key.fromMe) continue
      if (jid === 'status@broadcast') continue
      if (isJidNewsletter(jid)) continue
      const text = extractText(msg as unknown as Record<string, unknown>)
      if (!text) {
        logger.warn({ jid, messageId: msg.key.id, messageKeys: Object.keys((msg.message ?? {}) as Record<string, unknown>) }, 'Skipped inbound WhatsApp message without extractable text')
        continue
      }
      try {
        logger.warn({ jid, messageId: msg.key.id, preview: text.slice(0, 80) }, 'Handling inbound WhatsApp text message')
        await handleInboundText({
          admin,
          workspaceId,
          instanceId,
          sock,
          remoteJid: jid,
          alternateJid: address.alternateJid,
          phoneE164: address.phoneE164,
          participantJid: address.participantJid,
          participantAltJid: address.participantAltJid,
          text,
          waMessageId: msg.key.id ?? undefined,
          raw: msg,
        })
      } catch (error) {
        logger.error({ err: error, jid, messageId: msg.key.id }, 'Inbound WhatsApp message handling failed')
      }
    }
  })
}
