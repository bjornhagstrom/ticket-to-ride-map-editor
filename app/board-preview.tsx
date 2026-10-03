// A line drawing of what the board's format and orientation give: the board in its proportions, its
// fold lines between the panels, its size, and a ticket card lying or standing as the cards will print.
// The card is drawn larger than to scale; at true scale it would be a speck beside the board.
import { boardOf } from "./board";
import { cardSize } from "./print-plan";
import type { MapData } from "./map-data";

const LONG = 120, CARD_LONG = 30, GAP = 10, TEXT = 14, PAD = 1.5;

export function BoardPreview({ data }: { data: Pick<MapData, "format" | "orientation"> }) {
  const board = boardOf(data);
  const card = cardSize(board.format, board.orientation);
  const scale = LONG / Math.max(board.widthMm, board.heightMm);
  const w = board.widthMm * scale, h = board.heightMm * scale;
  const cardScale = CARD_LONG / Math.max(card.width, card.height);
  const cw = card.width * cardScale, ch = card.height * cardScale;
  const width = PAD + w + GAP + cw + PAD, height = PAD + Math.max(h, ch) + TEXT;
  const mm = (value: number) => value.toLocaleString("en-GB");
  const size = `${mm(board.widthMm)} × ${mm(board.heightMm)} mm`;
  return <div className="board-preview">
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${board.label}: ${size}, ${board.columns} × ${board.rows} panels; ticket cards ${card.width} × ${card.height} mm`}>
      <rect className="board-preview-board" x={PAD} y={PAD} width={w} height={h} />
      {Array.from({ length: board.columns - 1 }, (_, i) => { const x = PAD + (w * (i + 1)) / board.columns; return <line key={`v${i}`} className="board-preview-fold" x1={x} y1={PAD} x2={x} y2={PAD + h} />; })}
      {Array.from({ length: board.rows - 1 }, (_, i) => { const y = PAD + (h * (i + 1)) / board.rows; return <line key={`h${i}`} className="board-preview-fold" x1={PAD} y1={y} x2={PAD + w} y2={y} />; })}
      <text className="board-preview-size" x={PAD + w / 2} y={PAD + Math.max(h, ch) + TEXT - 3} textAnchor="middle">{size}</text>
      <rect className="board-preview-card" x={PAD + w + GAP} y={PAD + h - ch} width={cw} height={ch} rx={1.5} />
      <line className="board-preview-card-line" x1={PAD + w + GAP + cw * .18} y1={PAD + h - ch + ch * .28} x2={PAD + w + GAP + cw * .82} y2={PAD + h - ch + ch * .28} />
      <circle className="board-preview-card-points" cx={PAD + w + GAP + cw * .78} cy={PAD + h - ch * .2} r={Math.min(cw, ch) * .12} />
      <text className="board-preview-size" x={PAD + w + GAP + cw / 2} y={PAD + Math.max(h, ch) + TEXT - 3} textAnchor="middle">Ticket</text>
    </svg>
  </div>;
}
