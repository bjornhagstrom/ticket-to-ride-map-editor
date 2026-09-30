import { mapFormats, type MapFormat } from "./map-data";

// How a board is cut into printed sheets. The board's shape belongs to the map; everything here is
// a choice made per print run and never stored in the map. tests/print-plan.cjs pins the figures.

export type PaperId = "a4" | "a3" | "letter" | "tabloid";
export type SplitId = "sheet" | "panel" | "full";
export type SizeId = "standard" | "anniversary";
export type PrintChoice = { split: SplitId; paper: PaperId; size?: SizeId };
/** A board proofed panel by panel on A4, which is what the Print button did before it asked. */
export const DEFAULT_PRINT_CHOICE: PrintChoice = { split: "panel", paper: "a4", size: "standard" };
/** Where the last choice is remembered, in this browser only. */
export const PRINT_CHOICE_KEY = "ttr-print-choice";

/** Paper sizes, portrait. Declared in millimetres so the print dialog picks the right page. */
export const papers: { id: PaperId; label: string; widthMm: number; heightMm: number; note: string }[] = [
  { id: "a4", label: "A4", widthMm: 210, heightMm: 297, note: "210 × 297 mm" },
  { id: "a3", label: "A3", widthMm: 297, heightMm: 420, note: "297 × 420 mm" },
  { id: "letter", label: "US Letter", widthMm: 215.9, heightMm: 279.4, note: "8.5 × 11 in" },
  { id: "tabloid", label: "Tabloid", widthMm: 279.4, heightMm: 431.8, note: "11 × 17 in, the Letter world's A3" },
];

export const splits: { id: SplitId; label: string; note: string }[] = [
  { id: "sheet", label: "One sheet", note: "The whole board shrunk onto one sheet" },
  { id: "panel", label: "One sheet per panel", note: "Each fold panel on its own sheet, never enlarged" },
  { id: "full", label: "Full size", note: "Real size, spread over as many sheets as it takes" },
];

/** The real boards a full-size print can add up to. Anniversary exists only for the 2×3 shape. */
const boardSizes: Record<MapFormat, { id: SizeId; label: string; widthMm: number; heightMm: number }[]> = {
  "board-2x3": [
    { id: "standard", label: "Standard", widthMm: 790, heightMm: 525 },
    { id: "anniversary", label: "Anniversary", widthMm: 972, heightMm: 648 },
  ],
  "board-2x4": [{ id: "standard", label: "Standard", widthMm: 1053, heightMm: 526 }],
};

/** What no home printer reaches, on every side. */
export const PRINT_MARGIN_MM = 10;
/** The line naming the map and the sheet, above the artwork. */
export const PRINT_CAPTION_MM = 8;

/** A tile is a share of the board: x, y, width and height as fractions from 0 to 1. */
export type PrintTile = { x: number; y: number; width: number; height: number };
export type PrintPage = { index: number; column: number; row: number; tile: PrintTile; contentMm: { width: number; height: number } };
export type PrintPlan = {
  choice: Required<PrintChoice>;
  orientation: "portrait" | "landscape";
  /** The page as the printer should be asked for it, orientation applied. */
  pageMm: { width: number; height: number };
  /** Printed size against real size, never above 1. */
  scale: number;
  /** The board the pages add up to at 100 %. */
  boardMm: { width: number; height: number };
  columns: number;
  rows: number;
  pages: PrintPage[];
};

type Orientation = { orientation: "portrait" | "landscape"; pageMm: { width: number; height: number }; content: { width: number; height: number } };
const orientations = (paperId: PaperId): Orientation[] => {
  const paper = papers.find((item) => item.id === paperId) ?? papers[0];
  // Landscape first, so it wins a tie.
  return [
    { orientation: "landscape", pageMm: { width: paper.heightMm, height: paper.widthMm } },
    { orientation: "portrait", pageMm: { width: paper.widthMm, height: paper.heightMm } },
  ].map((item) => ({ ...item, orientation: item.orientation as Orientation["orientation"], content: { width: item.pageMm.width - 2 * PRINT_MARGIN_MM, height: item.pageMm.height - 2 * PRINT_MARGIN_MM - PRINT_CAPTION_MM } }));
};
// Division that does not count a sheet for floating-point dust.
const sheetsFor = (length: number, room: number) => Math.max(1, Math.ceil(length / room - 1e-9));

export function printChoiceFor(format: MapFormat, choice: PrintChoice): Required<PrintChoice> {
  const sizes = boardSizes[format] ?? boardSizes["board-2x3"];
  const size = choice.split === "full" && sizes.some((item) => item.id === choice.size) ? choice.size! : "standard";
  const paper = papers.some((item) => item.id === choice.paper) ? choice.paper : "a4";
  const split = splits.some((item) => item.id === choice.split) ? choice.split : "panel";
  return { split, paper, size };
}

export function printPlan(format: MapFormat, raw: PrintChoice): PrintPlan {
  const choice = printChoiceFor(format, raw);
  const board = mapFormats[format] ?? mapFormats["board-2x3"];
  const size = (boardSizes[format] ?? boardSizes["board-2x3"]).find((item) => item.id === choice.size)!;
  const boardMm = choice.split === "full" ? { width: size.widthMm, height: size.heightMm } : { width: board.widthMm, height: board.heightMm };

  let columns: number, rows: number, scale: number, best: Orientation;
  if (choice.split === "full") {
    // As few sheets as possible, each tile the same size, at 100 %.
    const counted = orientations(choice.paper).map((item) => ({ item, columns: sheetsFor(boardMm.width, item.content.width), rows: sheetsFor(boardMm.height, item.content.height) }));
    const pick = counted.reduce((a, b) => (b.columns * b.rows < a.columns * a.rows ? b : a));
    ({ columns, rows } = pick); best = pick.item; scale = 1;
  } else {
    // The largest scale that fits, never above full size.
    columns = choice.split === "panel" ? board.columns : 1;
    rows = choice.split === "panel" ? board.rows : 1;
    const tile = { width: boardMm.width / columns, height: boardMm.height / rows };
    const scored = orientations(choice.paper).map((item) => ({ item, scale: Math.min(1, item.content.width / tile.width, item.content.height / tile.height) }));
    const pick = scored.reduce((a, b) => (b.scale > a.scale ? b : a));
    best = pick.item; scale = pick.scale;
  }

  const pages: PrintPage[] = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    const tile = { x: column / columns, y: row / rows, width: 1 / columns, height: 1 / rows };
    return { index, column, row, tile, contentMm: { width: tile.width * boardMm.width * scale, height: tile.height * boardMm.height * scale } };
  });
  return { choice, orientation: best.orientation, pageMm: best.pageMm, scale, boardMm, columns, rows, pages };
}

export type PrintTableCell = { choice: Required<PrintChoice>; label: string; pages: number; scale: number };
/** Every way this board can be printed: the sizes on offer, and a row per paper to compare them by. */
export function printChoices(format: MapFormat) {
  const sizes = boardSizes[format] ?? boardSizes["board-2x3"];
  const columns: { label: string; choice: (paper: PaperId) => PrintChoice }[] = [
    { label: "One sheet", choice: (paper) => ({ split: "sheet", paper }) },
    { label: "Per panel", choice: (paper) => ({ split: "panel", paper }) },
    ...sizes.map((size) => ({ label: sizes.length > 1 ? `Full size, ${size.label}` : "Full size", choice: (paper: PaperId): PrintChoice => ({ split: "full", paper, size: size.id }) })),
  ];
  const table = papers.map((paper) => ({
    paper,
    cells: columns.map((column): PrintTableCell => {
      const plan = printPlan(format, column.choice(paper.id));
      return { choice: plan.choice, label: column.label, pages: plan.pages.length, scale: plan.scale };
    }),
  }));
  return { sizes, columns: columns.map((column) => column.label), table };
}

export const sameChoice = (a: PrintChoice, b: PrintChoice) => a.split === b.split && a.paper === b.paper && (a.split !== "full" || (a.size ?? "standard") === (b.size ?? "standard"));

/** One line saying what the printer will produce. */
export function describePlan(plan: PrintPlan): string {
  const paper = papers.find((item) => item.id === plan.choice.paper)!;
  const count = plan.pages.length;
  const sheets = `${count} sheet${count === 1 ? "" : "s"} of ${paper.label}, ${plan.orientation}`;
  if (plan.choice.split === "full") return `${sheets}, at 100 %. They add up to ${plan.boardMm.width} × ${plan.boardMm.height} mm: trim each at its marks and butt it to its neighbours.`;
  return `${sheets}, at ${Math.round(plan.scale * 100)} % of the real ${plan.boardMm.width} × ${plan.boardMm.height} mm board.`;
}
