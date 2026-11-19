export const SIZE = 8
export const TOUCH_LIFT = 64 // на сколько пикселей фигура поднимается над пальцем

export type Cell = [number, number]
// normal — обычная фигура; bomb — взрывает область 3×3; bolt — стирает ряд и столбец
export type PieceKind = 'normal' | 'bomb' | 'bolt'
export type Piece = {
  id: number
  cells: Cell[]
  w: number
  h: number
  color: number
  kind: PieceKind
}
export type Drag = {
  pieceId: number
  left: number
  top: number
  cell: number
  target: Cell | null
}

// Блоки с градиентом и лёгким объёмом
export const BLOCK_FX =
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-3px_0_rgba(0,0,0,0.22)]'

export const COLORS = [
  '',
  'bg-gradient-to-br from-[#8b9bff] to-[#5566ee]',
  'bg-gradient-to-br from-cyan-300 to-sky-500',
  'bg-gradient-to-br from-pink-400 to-rose-600',
  'bg-gradient-to-br from-violet-400 to-indigo-600',
  'bg-gradient-to-br from-emerald-300 to-teal-500',
]

export const SPECIAL_STYLE: Record<Exclude<PieceKind, 'normal'>, { icon: string; cls: string }> = {
  bomb: { icon: '💣', cls: 'bg-gradient-to-br from-amber-300 to-orange-600' },
  bolt: { icon: '⚡', cls: 'bg-gradient-to-br from-yellow-200 to-amber-500' },
}

export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function normalize(cells: Cell[]): Cell[] {
  const minR = Math.min(...cells.map(c => c[0]))
  const minC = Math.min(...cells.map(c => c[1]))
  return cells
    .map(([r, c]) => [r - minR, c - minC] as Cell)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

function rotate(cells: Cell[]): Cell[] {
  return normalize(cells.map(([r, c]) => [c, -r] as Cell))
}

function mirror(cells: Cell[]): Cell[] {
  return normalize(cells.map(([r, c]) => [r, -c] as Cell))
}

// Все повороты фигуры (и зеркальные, если нужно) без повторов
function orientations(base: Cell[], withMirror = false): Cell[][] {
  const seen = new Set<string>()
  const out: Cell[][] = []
  const first = normalize(base)
  const starts = withMirror ? [first, mirror(first)] : [first]
  for (const start of starts) {
    let x = start
    for (let i = 0; i < 4; i++) {
      const key = JSON.stringify(x)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(x)
      }
      x = rotate(x)
    }
  }
  return out
}

// Группы фигур. Чем больше weight, тем чаще выпадает группа.
const GROUPS: { weight: number; shapes: Cell[][] }[] = [
  { weight: 2, shapes: orientations([[0, 0]]) }, // точка
  { weight: 3, shapes: orientations([[0, 0], [0, 1]]) }, // линия из 2
  { weight: 3, shapes: orientations([[0, 0], [0, 1], [0, 2]]) }, // линия из 3
  { weight: 2, shapes: orientations([[0, 0], [0, 1], [1, 0], [1, 1]]) }, // квадрат 2×2
  { weight: 3, shapes: orientations([[0, 0], [1, 0], [1, 1]]) }, // уголок
  { weight: 2, shapes: orientations([[0, 0], [0, 1], [0, 2], [0, 3]]) }, // линия из 4
  { weight: 2, shapes: orientations([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]) }, // 2×3
  { weight: 4, shapes: orientations([[0, 0], [1, 0], [2, 0], [2, 1]], true) }, // Г-образные
  { weight: 3, shapes: orientations([[0, 0], [0, 1], [0, 2], [1, 1]]) }, // Т-образные
  { weight: 3, shapes: orientations([[0, 1], [0, 2], [1, 0], [1, 1]], true) }, // зигзаги
  {
    weight: 1,
    shapes: orientations([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]]),
  }, // квадрат 3×3
]

export function emptyBoard(): number[][] {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0))
}

// Особая одиночная фигура: бомба или молния
function makeSpecial(id: number): Piece {
  return {
    id,
    cells: [[0, 0]],
    h: 1,
    w: 1,
    color: 0,
    kind: Math.random() < 0.6 ? 'bomb' : 'bolt',
  }
}

export function makePiece(id: number, allowSpecial = false): Piece {
  if (allowSpecial && Math.random() < SPECIAL_CHANCE) return makeSpecial(id)
  const total = GROUPS.reduce((sum, g) => sum + g.weight, 0)
  let x = Math.random() * total
  let group = GROUPS[0]
  for (const g of GROUPS) {
    x -= g.weight
    if (x < 0) {
      group = g
      break
    }
  }
  const cells = group.shapes[Math.floor(Math.random() * group.shapes.length)]
  return {
    id,
    cells,
    h: Math.max(...cells.map(c => c[0])) + 1,
    w: Math.max(...cells.map(c => c[1])) + 1,
    color: 1 + Math.floor(Math.random() * 5),
    kind: 'normal',
  }
}

// Шанс, что новая фигура окажется бомбой или молнией
const SPECIAL_CHANCE = 0.16

export function canPlace(board: number[][], piece: Piece, r0: number, c0: number): boolean {
  for (const [dr, dc] of piece.cells) {
    const r = r0 + dr
    const c = c0 + dc
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return false
    if (board[r][c] !== 0) return false
  }
  return true
}

export function fitsAnywhere(board: number[][], piece: Piece): boolean {
  // Бомбу и молнию можно бросить на любую клетку
  if (piece.kind !== 'normal') return true
  for (let r = 0; r <= SIZE - piece.h; r++) {
    for (let c = 0; c <= SIZE - piece.w; c++) {
      if (canPlace(board, piece, r, c)) return true
    }
  }
  return false
}

// Ставит фигуру и убирает заполненные ряды и столбцы
export function placeOnBoard(board: number[][], piece: Piece, r0: number, c0: number) {
  const nb = board.map(row => [...row])
  for (const [dr, dc] of piece.cells) nb[r0 + dr][c0 + dc] = piece.color

  const fullRows: number[] = []
  const fullCols: number[] = []
  for (let r = 0; r < SIZE; r++) {
    if (nb[r].every(v => v !== 0)) fullRows.push(r)
  }
  for (let c = 0; c < SIZE; c++) {
    if (nb.every(row => row[c] !== 0)) fullCols.push(c)
  }

  // Запоминаем цвет сгоревших клеток для анимации
  const burst = new Map<string, number>()
  for (const r of fullRows) for (let c = 0; c < SIZE; c++) burst.set(`${r},${c}`, nb[r][c])
  for (const c of fullCols) for (let r = 0; r < SIZE; r++) burst.set(`${r},${c}`, nb[r][c])
  for (const r of fullRows) for (let c = 0; c < SIZE; c++) nb[r][c] = 0
  for (const c of fullCols) for (let r = 0; r < SIZE; r++) nb[r][c] = 0

  return {
    board: nb,
    cleared: fullRows.length + fullCols.length,
    burst: [...burst].map(([key, color]) => ({ key, color })),
  }
}

// Клетки, которые заденет бомба или молния в клетке (r0, c0)
export function blastCells(kind: PieceKind, r0: number, c0: number): Cell[] {
  const out: Cell[] = []
  if (kind === 'bomb') {
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (r >= 0 && c >= 0 && r < SIZE && c < SIZE) out.push([r, c])
      }
    }
  } else if (kind === 'bolt') {
    for (let i = 0; i < SIZE; i++) {
      out.push([r0, i])
      if (i !== r0) out.push([i, c0])
    }
  }
  return out
}

// Применяет бомбу или молнию: стирает клетки, возвращает поле и что именно сгорело
export function detonate(board: number[][], kind: PieceKind, r0: number, c0: number) {
  const nb = board.map(row => [...row])
  const hit = blastCells(kind, r0, c0)
  const burst: { key: string; color: number }[] = []
  let destroyed = 0
  for (const [r, c] of hit) {
    if (nb[r][c] !== 0) destroyed += 1
    // color 0 = пустая клетка: покажем только вспышку
    burst.push({ key: `${r},${c}`, color: nb[r][c] })
    nb[r][c] = 0
  }
  return { board: nb, destroyed, burst }
}

// Положение «призрака» фигуры под пальцем и клетка, куда она встанет (ближайшая подходящая)
export function computeDrag(
  piece: Piece,
  x: number,
  y: number,
  touch: boolean,
  board: number[][],
  boardEl: HTMLDivElement | null
): Drag {
  const rect = boardEl?.getBoundingClientRect()
  const cell = rect ? rect.width / SIZE : 40
  const left = x - (piece.w * cell) / 2
  const top = y - (piece.h * cell) / 2 - (touch ? TOUCH_LIFT : 0)

  let target: Cell | null = null
  if (rect) {
    const fc = (left - rect.left) / cell
    const fr = (top - rect.top) / cell
    let best = Infinity
    for (const r of [Math.floor(fr), Math.ceil(fr)]) {
      for (const c of [Math.floor(fc), Math.ceil(fc)]) {
        const ok =
          piece.kind === 'normal'
            ? canPlace(board, piece, r, c)
            : r >= 0 && c >= 0 && r < SIZE && c < SIZE
        if (!ok) continue
        const d = (r - fr) * (r - fr) + (c - fc) * (c - fc)
        if (d < best) {
          best = d
          target = [r, c]
        }
      }
    }
  }
  return { pieceId: piece.id, left, top, cell, target }
}

