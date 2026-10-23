import {
  setChatMenuButton,
  setMyCommands,
  setMyDescription,
  setMyShortDescription,
  type BotCommand,
} from './api'

export const BOT_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Открыть меню' },
  { command: 'settings', description: 'Настройки бота' },
  { command: 'next', description: 'Прислать слово сейчас' },
  { command: 'stats', description: 'Статистика' },
  { command: 'pause', description: 'Поставить на паузу' },
  { command: 'resume', description: 'Продолжить' },
  { command: 'debug', description: 'Диагностика' },
  { command: 'help', description: 'Помощь' },
]

const DESCRIPTION =
  'Присылаю сложные слова из ваших папок на сайте, помогаю повторять их и настраивать расписание. Начните с /start.'

const SHORT_DESCRIPTION =
  'Сложные слова из ваших папок с повторением и настройками.'

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
