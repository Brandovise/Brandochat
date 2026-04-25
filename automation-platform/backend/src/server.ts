import { env } from './config/env.js'
import { createApp } from './app.js'
import { startScheduler } from './flow/scheduler.js'
import { restoreConnectedWhatsAppSessions, startWhatsAppWatchdog } from './wa/baileysSession.js'

const app = createApp()
startScheduler()
void restoreConnectedWhatsAppSessions()
startWhatsAppWatchdog()

app.listen(env.PORT, () => {
  console.log(`API listening on http://127.0.0.1:${env.PORT}`)
})
