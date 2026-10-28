import {
  setChatMenuButton,
  setMyCommands,
  setMyDescription,
  setMyShortDescription,
  type BotCommand,
} from './api'

export const BOT_COMMANDS: BotCommand[] = [
  { command: 'start', description: '🏠 Главное меню' },
  { command: 'next', description: '📖 Слово прямо сейчас' },
  { command: 'stats', description: '📊 Прогресс' },
  { command: 'upcoming', description: '🗓 Ближайшие отправки' },
  { command: 'settings', description: '⚙️ Настройки' },
  { command: 'time', description: '⏰ Окно отправки' },
  { command: 'every', description: '🔁 Как часто присылать слова' },
  { command: 'pause', description: '⏸ Поставить на паузу' },
  { command: 'resume', description: '▶️ Продолжить отправку' },
  { command: 'help', description: '❓ Как работает бот' },
  { command: 'debug', description: '🛠 Диагностика' },
]

const DESCRIPTION =
  '📚 Учите английские слова без усилий: присылаю слова из ваших папок в удобное время и сам напоминаю, когда пора повторить. Нажмите «Старт» — и за минуту всё настроим.'

const SHORT_DESCRIPTION =
  '📚 Английские слова из ваших папок — вовремя и без усилий.'

export async function syncBotMenu(): Promise<void> {
  const results = await Promise.allSettled([
    setMyCommands(BOT_COMMANDS),
    setMyDescription(DESCRIPTION),
    setMyShortDescription(SHORT_DESCRIPTION),
    setChatMenuButton(),
  ])

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('telegram menu:', result.reason)
    }
  }
}
