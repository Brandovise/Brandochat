import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { getServiceRoleClient } from '../lib/supabase-clients.js'

type SessionSnapshotFile = {
  path: string
  data: string
}

type SessionSnapshot = {
  version: 1
  createdAt: string
  workspaceId: string
  instanceId: string
  files: SessionSnapshotFile[]
}

const BACKUP_BUCKET = process.env.WA_BACKUP_BUCKET || 'wa-sessions'
const BACKUP_ENABLED = process.env.WA_BACKUP_ENABLED === 'true'
const ENCRYPTION_SECRET = process.env.WA_BACKUP_ENCRYPTION_KEY || ''
const backupTimers = new Map<string, NodeJS.Timeout>()

function isConfigured(): boolean {
  return BACKUP_ENABLED && Boolean(ENCRYPTION_SECRET)
}

function objectPath(workspaceId: string, instanceId: string): string {
  return `${workspaceId}/${instanceId}.bin`
}

function encryptionKey(): Buffer {
  return crypto.createHash('sha256').update(ENCRYPTION_SECRET, 'utf8').digest()
}

function encryptPayload(raw: Buffer): Buffer {
  const iv = crypto.randomBytes(12)
  const key = encryptionKey()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(raw), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted])
}

function decryptPayload(raw: Buffer): Buffer {
  if (raw.length < 28) throw new Error('Invalid backup payload')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const encrypted = raw.subarray(28)
  const key = encryptionKey()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

async function walkFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const absolute = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(rootDir, absolute)))
      continue
    }
    if (entry.isFile()) files.push(path.relative(rootDir, absolute))
  }
  return files.sort()
}

async function readSnapshot(rootDir: string, workspaceId: string, instanceId: string): Promise<SessionSnapshot> {
  const filePaths = await walkFiles(rootDir)
  const files: SessionSnapshotFile[] = []
  for (const relPath of filePaths) {
    const absolute = path.join(rootDir, relPath)
    const content = await fs.readFile(absolute)
    files.push({ path: relPath, data: content.toString('base64') })
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    workspaceId,
    instanceId,
    files,
  }
}

export async function backupSessionAuthDir(args: { workspaceId: string; instanceId: string; authDir: string }): Promise<void> {
  if (!isConfigured()) return
  const snapshot = await readSnapshot(args.authDir, args.workspaceId, args.instanceId)
  if (snapshot.files.length === 0) return
  const packed = Buffer.from(JSON.stringify(snapshot), 'utf8')
  const compressed = gzipSync(packed)
  const encrypted = encryptPayload(compressed)
  const admin = getServiceRoleClient()
  const { error } = await admin.storage.from(BACKUP_BUCKET).upload(objectPath(args.workspaceId, args.instanceId), encrypted, {
    upsert: true,
    contentType: 'application/octet-stream',
  })
  if (error) throw new Error(`Failed to upload WA session backup: ${error.message}`)
}

export function scheduleSessionBackup(args: { workspaceId: string; instanceId: string; authDir: string; delayMs?: number }): void {
  if (!isConfigured()) return
  const key = `${args.workspaceId}:${args.instanceId}`
  const existing = backupTimers.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    void backupSessionAuthDir(args).catch((error) => {
      console.error('[wa-backup] backup failed', { workspaceId: args.workspaceId, instanceId: args.instanceId, error })
    })
    backupTimers.delete(key)
  }, args.delayMs ?? 5_000)
  backupTimers.set(key, timer)
}

export async function restoreSessionAuthDirIfAvailable(args: { workspaceId: string; instanceId: string; authDir: string }): Promise<boolean> {
  if (!isConfigured()) return false
  const admin = getServiceRoleClient()
  const { data, error } = await admin.storage.from(BACKUP_BUCKET).download(objectPath(args.workspaceId, args.instanceId))
  if (error || !data) return false
  const encrypted = Buffer.from(await data.arrayBuffer())
  const compressed = decryptPayload(encrypted)
  const json = gunzipSync(compressed).toString('utf8')
  const snapshot = JSON.parse(json) as SessionSnapshot
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0) return false
  for (const file of snapshot.files) {
    const target = path.join(args.authDir, file.path)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, Buffer.from(file.data, 'base64'))
  }
  return true
}
