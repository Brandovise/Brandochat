type AnyRecord = Record<string, unknown>

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toSafeKey(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

function readQuestionsAndAnswers(payload: AnyRecord): Record<string, string> {
  const questionsAndAnswers = payload.questions_and_answers
  if (!Array.isArray(questionsAndAnswers)) return {}
  const out: Record<string, string> = {}
  for (const item of questionsAndAnswers) {
    const row = asRecord(item)
    const question = asString(row.question)
    const answer = asString(row.answer)
    if (!question || !answer) continue
    const key = toSafeKey(question)
    if (!key) continue
    out[`qa.${key}`] = answer
  }
  return out
}

export function normalizePhone(input: string): string {
  if (!input) return ''
  const cleaned = input.replace(/[^\d+]/g, '')
  if (!cleaned) return ''
  if (cleaned.startsWith('+')) return cleaned
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`
  return `+${cleaned}`
}

function readQuestionPhone(payload: AnyRecord): string {
  const questionsAndAnswers = payload.questions_and_answers
  if (!Array.isArray(questionsAndAnswers)) return ''
  for (const item of questionsAndAnswers) {
    const row = asRecord(item)
    const q = asString(row.question).toLowerCase()
    const answer = asString(row.answer)
    if (!answer) continue
    if (q.includes('phone') || q.includes('handynummer') || q.includes('text reminder') || q.includes('telefon')) {
      const normalized = normalizePhone(answer)
      if (normalized) return normalized
    }
  }
  return ''
}

export function extractInviteePhone(eventPayload: AnyRecord): string {
  const payload = asRecord(eventPayload.payload)
  const textReminder = normalizePhone(asString(payload.text_reminder_number))
  if (textReminder) return textReminder

  const invitee = asRecord(payload.invitee)
  const inviteePhone = normalizePhone(asString(invitee.phone_number))
  if (inviteePhone) return inviteePhone

  const qPhone = readQuestionPhone(payload)
  if (qPhone) return qPhone

  const freeText = JSON.stringify(payload)
  const match = freeText.match(/(?:\+|00)?\d[\d\s\-()]{7,}\d/g)
  if (!match?.length) return ''
  return normalizePhone(match[0] ?? '')
}

export function toCalendlyTriggerPayload(eventPayload: AnyRecord): Record<string, unknown> {
  const payload = asRecord(eventPayload.payload)
  const event = asString(eventPayload.event)
  const invitee = asRecord(payload.invitee)
  const scheduledEvent = asRecord(payload.scheduled_event)
  const location = asRecord(scheduledEvent.location)
  const questionAnswers = readQuestionsAndAnswers(payload)
  return {
    calendlyEvent: event,
    inviteeName: asString(invitee.name) || asString(payload.name),
    inviteeEmail: asString(invitee.email) || asString(payload.email),
    inviteePhone: extractInviteePhone(eventPayload),
    inviteeStatus: asString(payload.status),
    inviteeCancelUrl: asString(payload.cancel_url),
    inviteeRescheduleUrl: asString(payload.reschedule_url),
    schedulingMethod: asString(payload.scheduling_method),
    meetingStart: asString(scheduledEvent.start_time),
    meetingEnd: asString(scheduledEvent.end_time),
    meetingName: asString(scheduledEvent.name),
    meetingStatus: asString(scheduledEvent.status),
    meetingJoinUrl: asString(location.join_url),
    eventType: asString(scheduledEvent.event_type),
    eventUri: asString(scheduledEvent.uri),
    timezone: asString(payload.timezone) || asString(invitee.timezone),
    ...questionAnswers,
  }
}
