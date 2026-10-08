export const SIZE = 8
export const TOUCH_LIFT = 64 // на сколько пикселей фигура поднимается над пальцем

export type Cell = [number, number]
export type Piece = { id: number; cells: Cell[]; w: number; h: number; color: number }
export type Drag = {
  pieceId: number
  left: number
  top: number
  cell: number
  target: Cell | null
}

export const COLORS = [
  '',
  'bg-[#6c7cff]',
  'bg-cyan-400',
  'bg-pink-500',
  'bg-indigo-400',
  'bg-emerald-400',
]

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

export function makePiece(id: number): Piece {
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
  }
}

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
  for (const r of fullRows) for (let c = 0; c < SIZE; c++) nb[r][c] = 0
  for (const c of fullCols) for (let r = 0; r < SIZE; r++) nb[r][c] = 0

  return { board: nb, cleared: fullRows.length + fullCols.length }
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
        if (!canPlace(board, piece, r, c)) continue
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

