import { type MapFormat } from "./map-data";
import { boardOf, type Orientation } from "./board";

// How a board is cut into printed sheets. The board's shape belongs to the map; everything here is
// a choice made per print run and never stored in the map. tests/print-plan.cjs pins the figures.

export type PaperId = "a4" | "a3" | "letter" | "tabloid";
export type SplitId = "sheet" | "panel" | "full" | "page";
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
  { id: "panel", label: "One sheet per panel of the game board", note: "Each fold panel on its own sheet, never enlarged" },
  { id: "full", label: "Full size", note: "Real size, spread over as many sheets as it takes" },
  { id: "page", label: "One page, real size", note: "The whole board on one page as big as the board: for a large-format printer, or to save as a PDF" },
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
/** How much of the paper's long side a browser leaves for the sheet. Safari's first print layout has
 *  about 264 mm down an upright A4 page — a 274 mm sheet spilled about 10 mm onto a second page, a
 *  268 mm one spilled too, and every later layout fitted — so in Safari the long side keeps 21 mm clear
 *  at each end instead of 10. Why Safari's first layout is shorter is not known; see docs/PRINTING.md. */
export type PrintProfile = { id: "standard" | "safari"; longMarginMm: number };
export const PRINT_PROFILES: Record<PrintProfile["id"], PrintProfile> = {
  standard: { id: "standard", longMarginMm: 10 },
  safari: { id: "safari", longMarginMm: 21 },
};
/** Safari, but not the browsers that put Safari in their user agent too. */
export const isSafari = (userAgent: string) => /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edg|android/i.test(userAgent);

/** Cut marks on a full-size sheet start this far past the artwork's corner… */
export const CUT_MARK_GAP_MM = 0.5;
/** …and end this far past it. They count against the page: Safari, with its headers and footers on,
 *  fitted a 274 mm sheet but spilled a 263 mm one whose 6 mm marks made it 275. */
export const CUT_MARK_REACH_MM = 2.5;

/** A tile is a share of the board: x, y, width and height as fractions from 0 to 1. */
export type PrintTile = { x: number; y: number; width: number; height: number };
export type PrintPage = { index: number; column: number; row: number; tile: PrintTile; contentMm: { width: number; height: number } };
export type PrintPlan = {
  choice: Required<PrintChoice>;
  /** Always portrait: the page every browser prints by default. The sheet on it is landscape and
   *  turned a quarter turn (PrintPages). */
  orientation: "portrait";
  /** Whether the sheet is turned a quarter turn on the page. A lying board is, so it runs along the
   *  page's long side; a standing board is not, and neither is the one page the size of the board: its
   *  page is as wide as the board, because the paper is the board's own. */
  turned: boolean;
  /** The page as the printer should be asked for it: the paper, upright. */
  pageMm: { width: number; height: number };
  /** Printed size against real size, never above 1. */
  scale: number;
  /** The board the pages add up to at 100 %. */
  boardMm: { width: number; height: number };
  columns: number;
  rows: number;
  pages: PrintPage[];
};

type Layout = { pageMm: { width: number; height: number }; content: { width: number; height: number } };
// Every page is upright, and the map is laid out as a landscape sheet turned a quarter turn on it.
// Safari ignores @page and prints portrait unless told otherwise in its own dialog; Chrome and
// Firefox follow @page. An upright page is the one thing all three do alike, so nobody has to pick an
// orientation. Turning the sheet only on portrait paper, by media query, was tried and failed: see
// docs/PRINTING.md. The sheet's room is the page's long side across and its short side, less the
// caption, down.
// A standing board needs no turn: its sheet is the page's short side across and its long side, less
// the caption, down.
const orientations = (paperId: PaperId, profile: PrintProfile, standing = false): Layout[] => {
  const paper = papers.find((item) => item.id === paperId) ?? papers[0];
  if (standing) return [{
    pageMm: { width: paper.widthMm, height: paper.heightMm },
    content: { width: paper.widthMm - 2 * PRINT_MARGIN_MM, height: paper.heightMm - 2 * profile.longMarginMm - PRINT_CAPTION_MM },
  }];
  return [{
    pageMm: { width: paper.widthMm, height: paper.heightMm },
    content: { width: paper.heightMm - 2 * profile.longMarginMm, height: paper.widthMm - 2 * PRINT_MARGIN_MM - PRINT_CAPTION_MM },
  }];
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

export function printPlan(format: MapFormat, raw: PrintChoice, profile: PrintProfile = PRINT_PROFILES.standard, orientation: Orientation = "landscape"): PrintPlan {
  const choice = printChoiceFor(format, raw);
  const board = boardOf({ format, orientation });
  const standing = board.orientation === "portrait";
  const size = (boardSizes[format] ?? boardSizes["board-2x3"]).find((item) => item.id === choice.size)!;
  const boardMm = choice.split === "full" ? (standing ? { width: size.heightMm, height: size.widthMm } : { width: size.widthMm, height: size.heightMm }) : { width: board.widthMm, height: board.heightMm };

  // The whole board on a page of its own size, upright and at 100 %: for a plotter or a large-format
  // printer, or to save as a PDF. The page is the board, its caption and the margin all round, whatever
  // the paper chosen was.
  if (choice.split === "page") {
    const pageMm = { width: boardMm.width + 2 * PRINT_MARGIN_MM, height: boardMm.height + PRINT_CAPTION_MM + 2 * PRINT_MARGIN_MM };
    return { choice, orientation: "portrait", turned: false, pageMm, scale: 1, boardMm, columns: 1, rows: 1, pages: [{ index: 0, column: 0, row: 0, tile: { x: 0, y: 0, width: 1, height: 1 }, contentMm: { ...boardMm } }] };
  }

  let columns: number, rows: number, scale: number, best: Layout;
  if (choice.split === "full") {
    // As few sheets as possible, each tile the same size, at 100 %.
    // The cut marks reach past both ends of the sheet's length, and past the far edge of its depth
    // (the near edge's marks rise into the caption line), so they come out of the room first.
    const room = (item: Layout) => ({ width: item.content.width - 2 * CUT_MARK_REACH_MM, height: item.content.height - CUT_MARK_REACH_MM });
    const counted = orientations(choice.paper, profile, standing).map((item) => ({ item, columns: sheetsFor(boardMm.width, room(item).width), rows: sheetsFor(boardMm.height, room(item).height) }));
    const pick = counted.reduce((a, b) => (b.columns * b.rows < a.columns * a.rows ? b : a));
    ({ columns, rows } = pick); best = pick.item; scale = 1;
  } else {
    // The largest scale that fits, never above full size.
    columns = choice.split === "panel" ? board.columns : 1;
    rows = choice.split === "panel" ? board.rows : 1;
    const tile = { width: boardMm.width / columns, height: boardMm.height / rows };
    const scored = orientations(choice.paper, profile, standing).map((item) => ({ item, scale: Math.min(1, item.content.width / tile.width, item.content.height / tile.height) }));
    const pick = scored.reduce((a, b) => (b.scale > a.scale ? b : a));
    best = pick.item; scale = pick.scale;
  }

  const pages: PrintPage[] = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    const tile = { x: column / columns, y: row / rows, width: 1 / columns, height: 1 / rows };
    return { index, column, row, tile, contentMm: { width: tile.width * boardMm.width * scale, height: tile.height * boardMm.height * scale } };
  });
  return { choice, orientation: "portrait", turned: !standing, pageMm: best.pageMm, scale, boardMm, columns, rows, pages };
}

export type PrintTableCell = { choice: Required<PrintChoice>; label: string; pages: number; scale: number };
/** Every way this board can be printed: the sizes on offer, and a row per paper to compare them by. */
export function printChoices(format: MapFormat, profile: PrintProfile = PRINT_PROFILES.standard, orientation: Orientation = "landscape") {
  const sizes = boardSizes[format] ?? boardSizes["board-2x3"];
  const columns: { label: string; choice: (paper: PaperId) => PrintChoice }[] = [
    { label: "One sheet", choice: (paper) => ({ split: "sheet", paper }) },
    { label: "Per panel", choice: (paper) => ({ split: "panel", paper }) },
    ...sizes.map((size) => ({ label: sizes.length > 1 ? `Full size, ${size.label}` : "Full size", choice: (paper: PaperId): PrintChoice => ({ split: "full", paper, size: size.id }) })),
  ];
  const table = papers.map((paper) => ({
    paper,
    cells: columns.map((column): PrintTableCell => {
      const plan = printPlan(format, column.choice(paper.id), profile, orientation);
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
  if (plan.choice.split === "page") return `One page, ${plan.pageMm.width} × ${plan.pageMm.height} mm, upright, with the board at 100 % — real size, ${plan.boardMm.width} × ${plan.boardMm.height} mm.`;
  const sheets = `${count} sheet${count === 1 ? "" : "s"} of ${paper.label}, upright${plan.turned ? " with the map turned" : ""}`;
  if (plan.choice.split === "full") return `${sheets}, at 100 % — real size. Together they make the ${plan.boardMm.width} × ${plan.boardMm.height} mm board: trim each at its marks and butt it to its neighbours.`;
  return `${sheets}, at ${Math.round(plan.scale * 100)} % of real size: the board prints smaller than the real ${plan.boardMm.width} × ${plan.boardMm.height} mm.`;
}

/** Cut-out ticket cards, 62 x 45 mm, lying the way the board lies: a landscape board gives landscape
 *  cards, a portrait one upright cards. As many to a row, and as many rows, as the page holds. */
export function cardSize(format: MapFormat, orientation: Orientation = "landscape"): { width: number; height: number } {
  const board = boardOf({ format, orientation });
  return board.width >= board.height ? { width: 62, height: 45 } : { width: 45, height: 62 };
}
export function cardsPerRow(pageMm: { width: number; height: number }, card: { width: number; height: number }): number {
  return Math.max(1, Math.floor((pageMm.width - 2 * PRINT_MARGIN_MM) / card.width));
}
/** The run's caption above the first row of cards. */
export const CARD_CAPTION_MM = 10;
/** How many sheets a deck of cards takes on a page, and how many cards go on a sheet. */
export function cardSheets(count: number, pageMm: { width: number; height: number }, card: { width: number; height: number }): { sheets: number; perSheet: number } {
  const room = pageMm.height - 2 * PRINT_MARGIN_MM;
  const perRow = cardsPerRow(pageMm, card);
  const firstRows = Math.max(1, Math.floor((room - CARD_CAPTION_MM) / card.height));
  const laterRows = Math.max(1, Math.floor(room / card.height));
  const first = perRow * firstRows, later = perRow * laterRows;
  return { sheets: count <= 0 ? 0 : count <= first ? 1 : 1 + Math.ceil((count - first) / later), perSheet: first };
}
