const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
const base = process.argv[2] || process.env.NEXT_PUBLIC_SITE_URL

if (!token || !secret || !base) {
  console.error('Нужны TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и адрес сайта.')
  console.error('Запуск: npm run telegram:setup -- https://твой-сайт.vercel.app')
  process.exit(1)
}

const webhookUrl = `${base.replace(/\/+$/, '')}/api/telegram/webhook`

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
  }),
})

const data = await response.json()
if (!data.ok) {
  console.error('Не удалось установить webhook:', data.description)
  process.exit(1)
}

console.log('Webhook установлен:', webhookUrl)

const infoResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
const info = await infoResponse.json()
if (info.ok) {
  console.log(JSON.stringify(info.result, null, 2))
}
