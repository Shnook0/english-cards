// Приблизительное «русское» произношение английских слов: из IPA-транскрипции
// получаем запись русскими буквами, например /ˈsaɪtˌsiːɪŋ/ → «сайтсиинг».
// Это подсказка для запоминания, а не точная фонетика.

// Порядок важен: сначала длинные последовательности (аффрикаты, дифтонги).
const RULES: Array<[string, string]> = [
  ['tʃ', 'ч'],
  ['dʒ', 'дж'],
  ['aɪ', 'ай'],
  ['eɪ', 'эй'],
  ['ɔɪ', 'ой'],
  ['aʊ', 'ау'],
  ['əʊ', 'оу'],
  ['oʊ', 'оу'],
  ['ɪə', 'иэ'],
  ['ɛə', 'эа'],
  ['eə', 'эа'],
  ['ʊə', 'уэ'],
  ['ju', 'ю'],
  ['jʊ', 'ю'],
  ['ɑːr', 'ар'],
  ['ɔːr', 'ор'],
  ['ɜːr', 'эр'],
  ['iː', 'и'],
  ['uː', 'у'],
  ['ɑː', 'а'],
  ['ɔː', 'о'],
  ['ɜː', 'э'],
  ['ɚ', 'эр'],
  ['ɝ', 'эр'],
  ['ɪ', 'и'],
  ['ɛ', 'э'],
  ['e', 'э'],
  ['æ', 'э'],
  ['ʌ', 'а'],
  ['ɐ', 'а'],
  ['ɑ', 'а'],
  ['a', 'а'],
  ['ɒ', 'о'],
  ['ɔ', 'о'],
  ['o', 'о'],
  ['ʊ', 'у'],
  ['u', 'у'],
  ['i', 'и'],
  ['ə', 'э'],
  ['ᵻ', 'и'],
  ['p', 'п'],
  ['b', 'б'],
  ['t', 'т'],
  ['d', 'д'],
  ['k', 'к'],
  ['ɡ', 'г'],
  ['g', 'г'],
  ['f', 'ф'],
  ['v', 'в'],
  ['θ', 'с'],
  ['ð', 'з'],
  ['s', 'с'],
  ['z', 'з'],
  ['ʃ', 'ш'],
  ['ʒ', 'ж'],
  ['h', 'х'],
  ['m', 'м'],
  ['n', 'н'],
  ['ŋk', 'нк'],
  ['ŋ', 'нг'],
  ['l', 'л'],
  ['ɫ', 'л'],
  ['ɹ', 'р'],
  ['r', 'р'],
  ['j', 'й'],
  ['w', 'в'],
  ['x', 'х'],
]

function convertWord(ipa: string): string {
  let result = ''
  let i = 0
  const text = ipa.normalize('NFC')

  while (i < text.length) {
    const rule = RULES.find(([from]) => text.startsWith(from, i))
    if (rule) {
      result += rule[1]
      i += rule[0].length
      continue
    }
    // Служебные и незнакомые символы пропускаем.
    i += 1
  }

  return result
}

// Принимает IPA одного слова или фразы через пробел.
export function ipaToRussian(ipa: string): string {
  return ipa
    .split(/\s+/)
    .map(convertWord)
    .filter(Boolean)
    .join(' ')
}

// ---------------------------------------------------------------------------
// Словарь CMU (ARPAbet): надёжный офлайн-источник для автоподстановки.
// ---------------------------------------------------------------------------

const ARPABET: Record<string, string> = {
  AA: 'а', AE: 'э', AH: 'а', AO: 'о', AW: 'ау', AY: 'ай', EH: 'э', ER: 'эр',
  EY: 'эй', IH: 'и', IY: 'и', OW: 'оу', OY: 'ой', UH: 'у', UW: 'у',
  B: 'б', CH: 'ч', D: 'д', DH: 'з', F: 'ф', G: 'г', HH: 'х', JH: 'дж',
  K: 'к', L: 'л', M: 'м', N: 'н', NG: 'нг', P: 'п', R: 'р', S: 'с',
  SH: 'ш', T: 'т', TH: 'с', V: 'в', W: 'в', Y: 'й', Z: 'з', ZH: 'ж',
}

// «S AY1 T S IY1 IH0 NG» → «сайтсиинг»
export function arpabetToRussian(phones: string): string {
  const list = phones.trim().split(/\s+/)
  let result = ''

  for (let i = 0; i < list.length; i += 1) {
    const phone = list[i].replace(/\d/g, '')
    const next = list[i + 1]?.replace(/\d/g, '')

    if (phone === 'Y' && next === 'UW') {
      result += 'ю'
      i += 1
    } else if (phone === 'NG' && next === 'K') {
      result += 'нк'
      i += 1
    } else if (phone === 'AH' && list[i].endsWith('0')) {
      result += 'э' // безударное «ə»: about → эбаут
    } else {
      result += ARPABET[phone] ?? ''
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Запасной вариант: по написанию слова (если нет ни словаря, ни транскрипции).
// Грубо, но лучше, чем пустое поле.
// ---------------------------------------------------------------------------

const SPELL_RULES: Array<[RegExp, string]> = [
  [/^tion/, 'шн'], [/^sion/, 'жн'], [/^ture/, 'чэ'], [/^ough/, 'оу'], [/^augh/, 'о'],
  [/^igh/, 'ай'], [/^tch/, 'ч'], [/^dge/, 'дж'], [/^sch/, 'ск'],
  [/^ph/, 'ф'], [/^sh/, 'ш'], [/^ch/, 'ч'], [/^th/, 'с'], [/^ck/, 'к'], [/^ng/, 'нг'],
  [/^qu/, 'кв'], [/^wh/, 'в'], [/^wr/, 'р'], [/^kn/, 'н'], [/^gh/, 'г'],
  [/^ee/, 'и'], [/^ea/, 'и'], [/^oo/, 'у'], [/^ou/, 'ау'], [/^ow/, 'оу'],
  [/^ai/, 'эй'], [/^ay/, 'эй'], [/^ey/, 'эй'], [/^oi/, 'ой'], [/^oy/, 'ой'],
  [/^au/, 'о'], [/^aw/, 'о'], [/^ie/, 'и'], [/^ew/, 'ью'], [/^oa/, 'оу'],
  [/^ar/, 'ар'], [/^or/, 'ор'], [/^er/, 'эр'], [/^ir/, 'эр'], [/^ur/, 'эр'],
  [/^ce/, 'сэ'], [/^ci/, 'си'], [/^cy/, 'си'], [/^ge/, 'дже'], [/^gi/, 'джи'],
  [/^x/, 'кс'], [/^j/, 'дж'], [/^y(?=[aeiou])/, 'й'],
]

const SPELL_LETTERS: Record<string, string> = {
  a: 'э', b: 'б', c: 'к', d: 'д', e: 'э', f: 'ф', g: 'г', h: 'х', i: 'и', k: 'к',
  l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'а',
  v: 'в', w: 'в', y: 'и', z: 'з',
}

const MAGIC_E: Record<string, string> = { a: 'эй', i: 'ай', o: 'оу', u: 'ю', e: 'и' }

function spellWord(raw: string): string {
  let word = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (!word) return ''

  // «make», «time», «home»: гласная + согласная + немая e
  let tail = ''
  const magic = word.match(/([aeiou])([b-df-hj-np-tv-z])e$/)
  if (magic && word.length > 3 && !/[aeiou]{2}[b-df-hj-np-tv-z]e$/.test(word)) {
    word = word.slice(0, -3)
    const consonant = magic[2] === 'c' ? 'с' : magic[2] === 'g' ? 'дж' : SPELL_LETTERS[magic[2]] ?? ''
    tail = MAGIC_E[magic[1]] + consonant
  } else if (word.length > 3 && word.endsWith('e') && !/[aeiouly]e$/.test(word)) {
    word = word.slice(0, -1)
  }
  if (word.endsWith('y') && word.length > 2) {
    word = word.slice(0, -1)
    tail = 'и' + tail
  }

  let result = ''
  let i = 0
  while (i < word.length) {
    const rest = word.slice(i)
    const rule = SPELL_RULES.find(([re]) => re.test(rest))
    if (rule) {
      const match = rest.match(rule[0])!
      result += rule[1]
      i += match[0].length
      continue
    }
    const letter = word[i]
    // удвоенные согласные читаются как одна
    if (letter === word[i + 1] && !'aeiou'.includes(letter)) {
      i += 1
      continue
    }
    result += SPELL_LETTERS[letter] ?? ''
    i += 1
  }
  return result + tail
}

export function spellToRussian(text: string): string {
  return text
    .split(/[\s-]+/)
    .map(spellWord)
    .filter(Boolean)
    .join(' ')
}

// ---------------------------------------------------------------------------
// Старый формат «bakery (бейкэри)»: произношение записано прямо в слове.
// ---------------------------------------------------------------------------

const CYRILLIC = /[а-яё]/i

export function splitWordPron(raw: string): { word: string; pron: string | null } {
  const value = (raw ?? '').trim()
  const match = value.match(/^(.*?)\s*[([]\s*([^()[\]]*)\s*[)\]]\s*$/)
  if (!match || !match[1].trim() || !CYRILLIC.test(match[2])) {
    return { word: value, pron: null }
  }
  return { word: match[1].trim(), pron: match[2].trim() || null }
}

// Слово без русской подсказки в скобках: для показа и проверки ответа.
export function cleanWord(raw: string): string {
  return splitWordPron(raw).word
}

type PronSource = {
  word: string
  transcription?: string | null
  pronunciation_ru?: string | null
}

// Произношение, которое не требует сети: сохранённое → из скобок → из транскрипции.
export function knownPronunciation(card: PronSource): string | null {
  const saved = card.pronunciation_ru?.trim()
  if (saved) return saved
  const fromWord = splitWordPron(card.word).pron
  if (fromWord) return fromWord
  const ipa = card.transcription?.trim()
  if (ipa) {
    const converted = ipaToRussian(ipa)
    if (converted) return converted
  }
  return null
}

// Карточка в новом формате: слово отдельно, произношение отдельно.
export function normalizeCardPron<T extends PronSource>(card: T): T {
  const { word, pron } = splitWordPron(card.word)
  if (!pron) return card
  return {
    ...card,
    word,
    pronunciation_ru: card.pronunciation_ru?.trim() || pron,
  }
}
