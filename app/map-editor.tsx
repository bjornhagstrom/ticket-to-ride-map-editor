"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Code, FileSpreadsheet, Grid3x3, MapPin, Route as RouteIcon, ScrollText, Sparkles, AlertTriangle, BarChart3, Crosshair, Settings2, Ticket as TicketIcon, BusFront, Check, ChevronDown, ChevronUp, GripVertical, CircleDot, CircleHelp, Download, Image as ImageIcon, Layers3, Lightbulb, Link2, MapPinPlus, MousePointer2, Printer, Redo2, RotateCcw, Ruler, StickyNote, Trash2, Undo2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MapArtwork, type Tool } from "./map-artwork";
import { AnalysisPanel, StopTicketsDialog, SuggestionsPanel, SuggestTicketsDialog, TicketsPanel, WelcomeGuide } from "./map-dialogs";
import { TicketCoveragePanel, type CoverageSort, BackgroundImageProperties, BackgroundProperties, NoteProperties, RouteProperties, StopProperties, StylePicker } from "./map-properties";
import { PrintDialog, PrintPages, type PrintParts } from "./map-print";
import { ImageStage } from "./map-image";
import { RulesPanel } from "./rules-panel";
import { type TicketLengthsView } from "./ticket-lengths";
import { type DeckCompareView } from "./deck-compare";
import { DEFAULT_PRINT_CHOICE, isSafari, PRINT_CHOICE_KEY, PRINT_PROFILES, type PrintChoice, type PrintProfile, printPlan } from "./print-plan";
import { useTicketSuggestion } from "./use-ticket-suggestion";
import { SettingsDialog, type StyleTarget } from "./map-styles";
import { bandsOf, bandCuts, mapDiameter, deckFigures, defaultStyle, deckRuleFor, TICKET_SUGGESTER, evaluateTicketDeck, suggestedDeckSize, ticketEndStopCount, type TicketStyle, autoPlaceLabels, labelledStops, setupBalance, stopCoverage, ticketBand, type TicketBand, reviewTickets, ticketPointsPerSpace, ticketCoverage, type RouteSuggestion, labelCovers, labelAngleOptions, routeSamplePoints, colourLengthTable, crossingPairs, buildAdjacency, networkStats, routeSpacing, shortestPath, suggestRoutes } from "./map-analysis";
import { canvasPoint, canvasPointRaw, pointsFor, samePair, stopById } from "./map-geometry";
import { REPO_URL } from "./version";
import { distancesCsv, routesCsv, stopsCsv, ticketsCsv } from "./csv-export";
import { readCsvImport, type CsvImport } from "./csv-import";
import { APP_VERSION, cloneForHistory, cloneMap, formatTimestamp, GUIDE_SEEN_KEY, HISTORY_LIMIT, MAX_IMAGE_WARN_BYTES, normalizeBackgroundFile, normalizeMap, normalizeNetworkFile, normalizeTicketFile, buildTicketFile, readMapFile, writeMapFile, mapPayload, networkPayload, readBackgroundImage, rescaleMapToFormat, MAP_HINT_KEY, MAP_HINT_X_KEY } from "./map-storage";
import { colorLabels, defaultTicketSet, DEFAULT_PLAYERS, DEFAULT_WAGONS_PER_PLAYER, IMAGE_KEEP_ON_BOARD, type Ticket, type StopTypeStyle, type WagonStyle, ticketsInSet, type TicketSet, emptyMap, initialMap, type LineStyle, DEFAULT_END_GAP_MM, mapFormats, type BackgroundImage, type BackgroundShape, type BackgroundType, type MapData, type MapFormat, type Point, type Route, type RouteType, type RouteTypeStyle, routeColors, STORAGE_KEY, type Stop, type StopSize, stopSizeMeta, type StopSymbol, stopSymbolMeta, type StopType, W } from "./map-data";

type MeasureResult = { from: string; to: string; distance: number; routeIds: string[] } | { from: string; to: string; unreachable: true };
type Danger = "reset" | "delete" | "load-blank" | "load-example" | "import-background" | "import-network" | "import-image" | "import-csv" | null;
type PendingImport = { kind: "background"; background: BackgroundShape[]; backgroundImage?: BackgroundImage } | { kind: "network"; stops: Stop[]; routes: Route[]; lineStyles: LineStyle[]; routeTypeStyles: RouteTypeStyle[]; stopTypeStyles: StopTypeStyle[]; wagonStyles: WagonStyle[]; tickets: Ticket[] } | { kind: "image"; image: BackgroundImage } | { kind: "csv"; result: CsvImport };
// Snapshots are geometry-only (see cloneForHistory), so a deep stack stays in the low megabytes
// even for a large map. Kept in memory for the session only, never written to local storage.

const readHintOpen = () => {
  try { return window.localStorage.getItem(MAP_HINT_KEY) !== "closed"; } catch { return true; }
};
const readHintOffset = () => {
  try { const x = Number(window.localStorage.getItem(MAP_HINT_X_KEY)); return Number.isFinite(x) ? x : 0; } catch { return 0; }
};

const RIGHT_WIDTH_KEY = "ttr-right-column-width";
const PRINT_RULES_KEY = "ttr-print-rules";
const PRINT_PARTS_KEY = "ttr-print-parts";
const RIGHT_WIDTH_DEFAULT = 400, RIGHT_WIDTH_MIN = 320, RIGHT_WIDTH_MAX = 900, RIGHT_WIDTH_WIDE = 720;

export function MapEditor() {
  const [data, setData] = useState<MapData>(emptyMap);
  const [ready, setReady] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [saved, setSaved] = useState(true);
  const [tool, setTool] = useState<Tool>("select");
  const [stopType, setStopType] = useState<StopType>("city");
  const [stopSize, setStopSize] = useState<StopSize>("medium");
  const [routeType, setRouteType] = useState<RouteType>("city");
  const [routeColor, setRouteColor] = useState("neutral");
  const [routeCurved, setRouteCurved] = useState(true);
  const [routeLineStyle, setRouteLineStyle] = useState<string | undefined>(undefined);
  const [stopSymbol, setStopSymbol] = useState<StopSymbol>("none");
  const [stopLetter, setStopLetter] = useState("");
  const [backgroundType, setBackgroundType] = useState<BackgroundType>("area");
  const [backgroundFill, setBackgroundFill] = useState("#b8ddea");
  const [backgroundStroke, setBackgroundStroke] = useState("#4f8394");
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [routeStart, setRouteStart] = useState<string | null>(null);
  const [showStyles, setShowStyles] = useState(false);
  const [styleTarget, setStyleTarget] = useState<StyleTarget>({ kind: "stop" });
  const [routeHintOpen, setRouteHintOpen] = useState(readHintOpen);
  const [linkParallel, setLinkParallel] = useState(true);
  // Collapsing the help is a lasting preference, not a per-selection one: reopening it on the next
  // route you click would defeat the point of hiding it.
  const [routeHintX, setRouteHintX] = useState(readHintOffset);
  const moveRouteHint = (value: number) => {
    setRouteHintX(value);
    try { window.localStorage.setItem(MAP_HINT_X_KEY, String(Math.round(value))); } catch { /* private mode */ }
  };
  const toggleRouteHint = () => setRouteHintOpen((open) => {
    try { window.localStorage.setItem(MAP_HINT_KEY, open ? "closed" : "open"); } catch { /* private mode */ }
    return !open;
  });
  // How the board is printed is chosen per run and kept in this browser, never in the map.
  const [printChoice, setPrintChoice] = useState<PrintChoice>(DEFAULT_PRINT_CHOICE);
  const [showPrint, setShowPrint] = useState(false);
  const [printRequest, setPrintRequest] = useState(0);
  const [makingImage, setMakingImage] = useState(false);
  // The rules text is a panel in the right column. Whether it prints after the board is a choice made
  // at the print dialog, kept in this browser like the other print choices.
  const [showRules, setShowRules] = useState(false);
  // The rules panel asks for stops to be clicked on the map; the map hands the click to it.
  const rulesPickRef = useRef<{ stop: (stopId: string) => boolean; cancel: () => boolean } | null>(null);
  const [rulesPicking, setRulesPicking] = useState(false);
  // What a print run holds is ticked in the print dialog and kept in this browser, like the other print
  // choices. An earlier build kept one word for the board and the rules; it still means what it meant.
  const [printParts, setPrintParts] = useState<PrintParts>({ board: true, tickets: false, rules: true });
  useEffect(() => { queueMicrotask(() => { try {
    const stored = localStorage.getItem(PRINT_PARTS_KEY);
    if (stored) { const parsed = JSON.parse(stored) as Partial<PrintParts>; setPrintParts({ board: Boolean(parsed.board), tickets: Boolean(parsed.tickets), rules: Boolean(parsed.rules) }); return; }
    const old = localStorage.getItem(PRINT_RULES_KEY);
    if (old === "off" || old === "board") setPrintParts({ board: true, tickets: false, rules: false });
    else if (old === "rules") setPrintParts({ board: false, tickets: false, rules: true });
    else if (old === "on" || old === "both") setPrintParts({ board: true, tickets: false, rules: true });
  } catch { /* keep the default */ } }); }, []);
  const choosePrintParts = (parts: PrintParts) => { setPrintParts(parts); try { localStorage.setItem(PRINT_PARTS_KEY, JSON.stringify(parts)); } catch { /* not remembered, still used */ } };
  // How wide the right column is while Map balance is open; the left edge of the column is its handle.
  const [rightWidth, setRightWidth] = useState(RIGHT_WIDTH_DEFAULT);
  const resizeRight = (width: number) => {
    const next = Math.round(Math.min(Math.max(width, RIGHT_WIDTH_MIN), Math.max(RIGHT_WIDTH_MIN, Math.min(RIGHT_WIDTH_MAX, window.innerWidth - 246 - 320))));
    setRightWidth(next);
    try { localStorage.setItem(RIGHT_WIDTH_KEY, String(next)); } catch { /* not remembered, still used */ }
  };
  const resetRight = () => { setRightWidth(RIGHT_WIDTH_DEFAULT); try { localStorage.removeItem(RIGHT_WIDTH_KEY); } catch { /* nothing to forget */ } };
  useEffect(() => { queueMicrotask(() => { try { const stored = Number(localStorage.getItem(RIGHT_WIDTH_KEY)); if (stored > 0) setRightWidth(Math.min(Math.max(stored, RIGHT_WIDTH_MIN), RIGHT_WIDTH_MAX)); } catch { /* keep the default */ } }); }, []);
  // Safari gets shorter sheets: its first print layout has less room (docs/PRINTING.md). Found after
  // mounting, so the server-rendered page and the first client render agree.
  const [printProfile, setPrintProfile] = useState<PrintProfile>(PRINT_PROFILES.standard);
  useEffect(() => { queueMicrotask(() => { if (isSafari(navigator.userAgent)) setPrintProfile(PRINT_PROFILES.safari); }); }, []);
  const [measureStart, setMeasureStart] = useState<string | null>(null);
  const [ticketStart, setTicketStart] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
  // The ticket row under the pointer: its path is marked on the map before anything is clicked.
  const [hoveredTicket, setHoveredTicket] = useState<string | null>(null);
  const [showTickets, setShowTickets] = useState(false);
  const [ticketSetId, setTicketSetId] = useState(defaultTicketSet.id);
  // "deck" is the Print deck button in the Tickets panel: just the cards, whatever is ticked in the print dialog.
  const [printScope, setPrintScope] = useState<"map" | "deck">("map");
  const [pickTo, setPickTo] = useState<Point | null>(null);
  const [hoveredStop, setHoveredStop] = useState<string | null>(null);
  const [coverageSort, setCoverageSort] = useState<CoverageSort>({ column: "stop", descending: false });
  const [onlyUncovered, setOnlyUncovered] = useState(false);
  const [stopTicketView, setStopTicketView] = useState<{ stopId: string; band?: TicketBand } | null>(null);
  const [showSuggest, setShowSuggest] = useState(false);
  const [bottleneckTable, setBottleneckTable] = useState<number | null>(null);
  const [bottleneckRoutes, setBottleneckRoutes] = useState<Set<string>>(new Set());
  const [suggestStyle, setSuggestStyle] = useState<TicketStyle | null>(null);
  const [suggestSize, setSuggestSize] = useState<number | null>(null);
  const [suggestKeep, setSuggestKeep] = useState(false);
  const [suggestSeed, setSuggestSeed] = useState(1);
  const [suggestName, setSuggestName] = useState("");
  const [measureResult, setMeasureResult] = useState<MeasureResult | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // What the row under the pointer in Map balance is about, marked on the map while it is pointed at.
  const [balanceRoutes, setBalanceRoutes] = useState<Set<string> | null>(null);
  const [balanceStop, setBalanceStop] = useState<string | null>(null);
  // What a click in Map balance has pinned on the map: it stays marked until the same thing is clicked again.
  const [pin, setPin] = useState<{ key: string; routes: string[] | null; stop: string | null } | null>(null);
  const pinnedRoutes = useMemo(() => (pin?.routes ? new Set(pin.routes) : null), [pin]);
  const togglePin = (key: string, routes: string[] | null, stop: string | null) => setPin((current) => (current?.key === key ? null : { key, routes, stop }));
  const closeAnalysis = () => { setShowAnalysis(false); setBalanceRoutes(null); setBalanceStop(null); setPin(null); setBottleneckRoutes(new Set()); };
  // The right column holds one panel at a time: Map balance, Suggest routes or Tickets.
  const openTickets = () => { closeAnalysis(); setShowSuggestions(false); setHoveredSuggestion(null); setShowRules(false); setShowTickets(true); };
  const openRules = () => { closeAnalysis(); setShowSuggestions(false); setHoveredSuggestion(null); setShowTickets(false); setShowRules(true); };
  const widePanel = showAnalysis || showTickets || showRules;
  // The suggested route the pointer is on, drawn on the map while it is there.
  const [hoveredSuggestion, setHoveredSuggestion] = useState<RouteSuggestion | null>(null);
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [selectedBackground, setSelectedBackground] = useState<string | null>(null);
  const [imageSelected, setImageSelected] = useState(false);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [past, setPast] = useState<MapData[]>([]);
  const [future, setFuture] = useState<MapData[]>([]);
  const [danger, setDanger] = useState<Danger>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const dragStopRef = useRef<string | null>(null);
  // A stop whose name is being turned round it with the pointer.
  const dragStopLabelRef = useRef<string | null>(null);
  const dragWaypointRef = useRef<{ routeId: string; index: number; grabOffset: Point } | null>(null);
  const dragBackgroundPointRef = useRef<{ shapeId: string; index: number } | null>(null);
  const dragBackgroundLabelRef = useRef<string | null>(null);
  const dragImageRef = useRef<{ mode: "move"; offsetX: number; offsetY: number } | { mode: "scale" | "rotate" } | null>(null);
  const dragNoteRef = useRef<{ id: string; mode: "move"; offsetX: number; offsetY: number } | { id: string; mode: "resize" } | null>(null);
  const dragSnapshotRef = useRef<MapData | null>(null);
  const draggedRef = useRef(false);
  const undoRef = useRef<() => void>(() => {});
  const cancelPickRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const fileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);
  const format = mapFormats[data.format];

  useEffect(() => { queueMicrotask(() => { try { const stored = localStorage.getItem(STORAGE_KEY); if (stored) { setData(normalizeMap(JSON.parse(stored))); localStorage.setItem(GUIDE_SEEN_KEY, "1"); } else if (!localStorage.getItem(GUIDE_SEEN_KEY)) setShowGuide(true); } catch { /* ignore invalid local state */ } setReady(true); }); }, []);
  useEffect(() => { if (!ready) return; localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); const timer = window.setTimeout(() => setSaved(true), 0); return () => window.clearTimeout(timer); }, [data, ready]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { const target = event.target as HTMLElement | null; if (target?.tagName === "TEXTAREA") { target.blur(); return; } cancelPickRef.current(); return; }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      // Leave the browser's own text undo alone while typing in a field.
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) redoRef.current(); else undoRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Wagons are measured against the board the map is for. Printing smaller or larger scales them
  // with everything else.
  const scaleWidthMm = format.widthMm;
  const crossings = useMemo(() => crossingPairs(data), [data]);
  // Routes drawn too short to hold their own wagons at real component size.
  const spacing = useMemo(() => routeSpacing(data, scaleWidthMm), [data, scaleWidthMm]);
  // The deck the editor is currently working in. Derived rather than corrected in an effect, so a
  // freshly imported or loaded map always lands on a deck that exists.
  const activeTicketSet = data.ticketSets.find((set) => set.id === ticketSetId) ?? data.ticketSets[0];
  const ticketsHere = ticketsInSet(data, activeTicketSet.id);
  // What is ticked, less what there is nothing to print of: a deck with no tickets has no cards, and a map with
  // no rules text has no rules.
  // On one page the size of the board nothing else fits: the tickets and the rules are printed apart.
  const onePageRun = printChoice.split === "page";
  const printPartsNow: PrintParts = { board: printParts.board, tickets: printParts.tickets && ticketsHere.length > 0 && !onePageRun, rules: printParts.rules && Boolean(data.rules?.trim()) && !onePageRun };
  const runParts: PrintParts = printScope === "deck" ? { board: false, tickets: true, rules: false } : printPartsNow;
  const ticketReviews = useMemo(() => reviewTickets(data, activeTicketSet.id), [data, activeTicketSet.id]);
  const ticketRate = useMemo(() => ticketPointsPerSpace(ticketReviews), [ticketReviews]);
  const ticketDiameter = useMemo(() => mapDiameter(data), [data]);
  const coverageRows = useMemo(() => stopCoverage(data, activeTicketSet.id), [data, activeTicketSet.id]);
  const setup = useMemo(() => setupBalance(data, activeTicketSet.id), [data, activeTicketSet.id]);
  // Crowding is read at a table the designer chooses, inside the range the map is built for.
  const playerRange = data.players ?? DEFAULT_PLAYERS;
  const atTable = Math.min(playerRange.max, Math.max(playerRange.min, bottleneckTable ?? playerRange.max));
  const deckReport = useMemo(() => evaluateTicketDeck(data, { setId: activeTicketSet.id, atTable }), [data, activeTicketSet.id, atTable]);
  // The suggester runs on the whole map, so it only needs to be asked again when the map, the deck
  // or one of the dialog's own choices changes.
  const suggestChoice = suggestStyle ?? defaultStyle(data, activeTicketSet.id);
  const currentDeckReport = useMemo(() => evaluateTicketDeck(data, { style: suggestChoice, setId: activeTicketSet.id }), [data, suggestChoice, activeTicketSet.id]);
  // The deck's lengths against the official decks, and against the map's own rules when it has chosen some.
  const lengthsView = useMemo((): TicketLengthsView => { const rule = deckRuleFor(data, suggestChoice); return { counts: currentDeckReport.bins, regular: currentDeckReport.regular, reach: currentDeckReport.reach, skipped: currentDeckReport.skipped, long: currentDeckReport.long, official: TICKET_SUGGESTER.styles.generic.bins, own: rule.custom ? { label: rule.label, bins: rule.bins } : null }; }, [data, suggestChoice, currentDeckReport]);
  // This deck against another, when the map has more than one: only worked out while the Tickets panel is open.
  const [compareSetId, setCompareSetId] = useState<string | null>(null);
  const compareOthers = data.ticketSets.filter((set) => set.id !== activeTicketSet.id);
  const compareOtherId = compareOthers.find((set) => set.id === compareSetId)?.id ?? compareOthers[0]?.id ?? null;
  const compareView = useMemo((): DeckCompareView | null => {
    if (!showTickets || !compareOtherId) return null;
    const other = data.ticketSets.find((set) => set.id === compareOtherId);
    if (!other) return null;
    return {
      others: data.ticketSets.filter((set) => set.id !== activeTicketSet.id).map((set) => ({ id: set.id, label: set.label })),
      otherId: compareOtherId,
      onOther: setCompareSetId,
      a: { label: activeTicketSet.label, figures: deckFigures(data, activeTicketSet.id, deckReport) },
      b: { label: other.label, figures: deckFigures(data, other.id, evaluateTicketDeck(data, { setId: other.id, atTable })) },
    };
  }, [showTickets, data, activeTicketSet, compareOtherId, deckReport, atTable]);
  const suggestDefaultSize = useMemo(() => {
    // By the stops a ticket can end at, as the suggester does: a junction is not one.
    const size = suggestedDeckSize(data, suggestChoice, ticketEndStopCount(data) || data.stops.length);
    return size.regular + size.long;
  }, [data, suggestChoice]);
  const { suggestion, busy: suggestBusy } = useTicketSuggestion(showSuggest, data, {
    style: suggestChoice,
    seed: suggestSeed,
    deckSize: suggestSize ?? suggestDefaultSize,
    setId: activeTicketSet.id,
    keep: suggestKeep ? ticketsInSet(data, activeTicketSet.id).map((ticket) => ticket.id) : [],
  });
  // Either into a deck of its own, named by the person, or over the one being worked on.
  const applySuggestion = (mode: "new" | "replace", id: string) => {
    if (!suggestion?.tickets.length) return;
    const target = mode === "replace" ? activeTicketSet.id : id;
    const label = suggestName.trim();
    change((draft) => {
      if (mode === "new") draft.ticketSets.push({ id: target, label });
      else draft.tickets = draft.tickets.filter((ticket) => (ticket.set ?? draft.ticketSets[0].id) !== target);
      for (const ticket of suggestion.tickets) draft.tickets.push({ ...ticket, set: target });
      return draft;
    });
    setTicketSetId(target);
    setSelectedTicket(null);
    setShowSuggest(false);
    openTickets();
    toast.success(`${suggestion.tickets.length} tickets suggested into ${mode === "replace" ? activeTicketSet.label : label}.`);
  };
  // The Tickets panel stays under the dialog, so backing out leaves it as it was.
  const openSuggest = () => { setSuggestStyle(null); setSuggestSize(null); setSuggestSeed(1); setSuggestName(""); setShowSuggest(true); };
  // The tickets behind one number in the coverage panel.
  const viewedStopTickets = useMemo(() => {
    if (!stopTicketView) return [];
    return ticketReviews
      .filter((review) => (review.ticket.a === stopTicketView.stopId || review.ticket.b === stopTicketView.stopId)
        && (!stopTicketView.band || ticketBand(review.distance, ticketDiameter, bandsOf(data)) === stopTicketView.band))
      .map((review) => ({
        id: review.ticket.id,
        other: stopById(data, review.ticket.a === stopTicketView.stopId ? review.ticket.b : review.ticket.a)?.name ?? "—",
        distance: review.distance,
        points: review.ticket.points,
        deck: activeTicketSet.label,
      }));
  }, [stopTicketView, ticketReviews, data, ticketDiameter, activeTicketSet.label]);
  const highlightRoutes = useMemo(() => new Set((hoveredTicket ?? selectedTicket) ? ticketReviews.find((review) => review.ticket.id === (hoveredTicket ?? selectedTicket))?.routeIds ?? [] : []), [hoveredTicket, selectedTicket, ticketReviews]);
  const routeSamples = useMemo(() => routeSamplePoints(data), [data]);
  const coveredNames = useMemo(() => labelledStops(data).filter((stop) => labelCovers(data, stop, routeSamples)), [data, routeSamples]);

  const adjacency = useMemo(() => buildAdjacency(data), [data]);
  // All three two-click tools wait on a first stop the same way, so they share one pending state and
  // one set of map feedback.
  const pendingStop = tool === "ticket" ? ticketStart : tool === "measure" ? measureStart : tool === "route" ? routeStart : null;
  const previewTarget = pendingStop && hoveredStop && hoveredStop !== pendingStop ? hoveredStop : null;
  const preview = useMemo(() => {
    if (!previewTarget || !pendingStop || tool === "route") return null;
    const path = shortestPath(adjacency, pendingStop, previewTarget);
    const from = stopById(data, pendingStop)?.name ?? "";
    const to = stopById(data, previewTarget)?.name ?? "";
    if (!path) return { routes: new Set<string>(), label: `${from} → ${to} · not connected` };
    const worth = tool === "ticket" ? `${Math.max(1, Math.round(path.distance * ticketRate))} points` : `${path.distance} spaces`;
    return { routes: new Set(path.routeIds), label: `${from} → ${to} · ${worth}` };
  }, [previewTarget, pendingStop, tool, adjacency, data, ticketRate]);
  // While anything is marked on the map, the other routes step back so the marked ones are seen at once.
  const hasMarks = highlightRoutes.size > 0 || Boolean(balanceRoutes?.size) || Boolean(pinnedRoutes?.size) || Boolean(preview?.routes.size) || (showAnalysis && bottleneckRoutes.size > 0);
  const cancelPick = () => { setTicketStart(null); setMeasureStart(null); setRouteStart(null); setHoveredStop(null); setPickTo(null); };
  const stats = useMemo(() => networkStats(data), [data]);
  const colourTable = useMemo(() => colourLengthTable(data), [data]);
  const lowConnectionStops = useMemo(() => data.stops.filter((stop) => (stats.neighbours.get(stop.id) ?? 0) < 2), [data.stops, stats]);
  const avgHubDegree = data.stops.length ? Array.from(stats.hubDegree.values()).reduce((sum, value) => sum + value, 0) / data.stops.length : 0;
  const suggestions = useMemo(() => suggestRoutes(data, stats, colourTable), [data, stats, colourTable]);
  const selectedS = data.stops.find((stop) => stop.id === selectedStop);
  // For the selected stop: is its name on a route, which bearings are clear, and which is best.
  const selectedLabelState = useMemo(() => {
    if (!selectedS) return { covers: false, clear: [] as number[], best: 0 };
    const options = labelAngleOptions(data, selectedS, routeSamples);
    const clear = options.filter((option) => option.overlap === 0).map((option) => option.angle);
    const best = [...options].sort((a, b) => a.overlap - b.overlap)[0]?.angle ?? 0;
    return { covers: labelCovers(data, selectedS, routeSamples), clear, best };
  }, [data, routeSamples, selectedS]);
  // Tickets that name the selected stop, from every deck, so the panel shows what depends on it.
  // Kept deck by deck: two decks being compared often name the same stop, and a flat list makes
  // them look like one deck with duplicates.
  const stopTickets = selectedS ? data.ticketSets.map((set) => ({
    id: set.id,
    label: set.label,
    tickets: ticketsInSet(data, set.id)
      .filter((ticket) => ticket.a === selectedS.id || ticket.b === selectedS.id)
      .map((ticket) => ({ id: ticket.id, other: stopById(data, ticket.a === selectedS.id ? ticket.b : ticket.a)?.name ?? "—", points: ticket.points })),
  })).filter((deck) => deck.tickets.length || data.ticketSets.length === 1) : [];
  const litTicket = selectedTicket ? data.tickets.find((ticket) => ticket.id === selectedTicket) : undefined;
  // A deck can be given any name at all, so the button that carries it has to be able to cut it off.
  const ticketButtonLabel = `Tickets · ${ticketsHere.length}${data.ticketSets.length > 1 ? ` in ${activeTicketSet.label}` : ""}`;
  const startTicketFrom = (stopId: string) => { setShowTickets(false); setSelectedTicket(null); enterTool("ticket"); setTicketStart(stopId); };
  const openTicket = (ticketId: string) => { const ticket = data.tickets.find((item) => item.id === ticketId); if (!ticket) return; setTicketSetId(ticket.set ?? data.ticketSets[0].id); setSelectedTicket(ticketId); openTickets(); };
  const selectedR = data.routes.find((route) => route.id === selectedRoute);
  // Put the shape hint on whichever edge of the board the selected route is furthest from,
  // so it never covers the bend points you are about to drag.
  const selectedRouteHasSlots = Boolean(selectedR) && !(data.routeTypeStyles.find((style) => style.id === selectedR?.type)?.infrastructure ?? false);
  // Whichever object is selected gets the same box, on whichever edge of the board it is furthest
  // from, so it never covers what you are editing.
  const hint = (() => {
    const above = (y: number) => y > format.height / 2;
    if (selectedR) {
      const points = pointsFor(data, selectedR);
      const atTop = points.length ? above(points.reduce((sum, point) => sum + point.y, 0) / points.length) : false;
      return { atTop, title: "Editing this route", body: <>Click a <b>+</b> to add a bend point anywhere along it · drag a bend point to move it · <b>double-click a bend point to remove it</b> · routes are smooth curves by default: untick <b>Draw as a smooth curve</b> under Properties for straight segments between the bends{selectedRouteHasSlots ? <> · <b>click a wagon space to mark it as needing a locomotive</b>, and click it again to clear it</> : null}</> };
    }
    if (selectedS) return { atTop: above(selectedS.y), title: "Editing this stop", body: <>Drag the stop to move it, and every route into it follows · <b>hold Shift to drag it even when its position is locked</b> · <b>drag its name round the stop</b> to move it clear of a route, and <b>Lock name</b> under Properties to keep it there · with the Draw route tool, click this stop and then another to connect them</> };
    return null;
  })();
  const selectedB = data.background.find((shape) => shape.id === selectedBackground);
  const selectedN = data.notes.find((note) => note.id === selectedNote);
  const change = (fn: (draft: MapData) => MapData) => setData((previous) => { setPast((history) => [...history, cloneForHistory(previous)].slice(-HISTORY_LIMIT)); setFuture([]); setSaved(false); return fn(cloneMap(previous)); });
  const pushHistory = (snapshot: MapData) => { setPast((history) => [...history, snapshot].slice(-HISTORY_LIMIT)); setFuture([]); setSaved(false); };
  const beginDrag = () => { dragSnapshotRef.current = cloneForHistory(data); draggedRef.current = false; };
  const clearSelection = () => { setSelectedStop(null); setSelectedRoute(null); setSelectedBackground(null); setImageSelected(false); setSelectedNote(null); };
  const chooseImage = () => { setImageSelected(true); setSelectedStop(null); setSelectedRoute(null); setSelectedBackground(null); setSelectedNote(null); setTool("select"); };
  const chooseNote = (id: string) => { setSelectedNote(id); setSelectedStop(null); setSelectedRoute(null); setSelectedBackground(null); setImageSelected(false); setTool("select"); };
  // Going to a tool, whoever asks. A click on the tool row goes through selectTool instead, which
  // lets a tool go when it is already the current one.
  const enterTool = (next: Tool) => {
    setTool(next);
    cancelPick();
    setDraftPoints([]);
    if (next === "measure") setMeasureResult(null);
    if (next !== "select") clearSelection();
  };
  const selectTool = (next: Tool) => enterTool(next === tool ? "select" : next);
  const undo = () => { const previous = past.at(-1); if (!previous) return; setFuture((items) => [cloneForHistory(data), ...items]); setData(previous); setPast((items) => items.slice(0, -1)); clearSelection(); };
  const redo = () => { const next = future[0]; if (!next) return; setPast((items) => [...items, cloneForHistory(data)]); setData(next); setFuture((items) => items.slice(1)); clearSelection(); };
  useEffect(() => { undoRef.current = undo; redoRef.current = redo; cancelPickRef.current = () => {
    // Picking a stop for the rules text is the innermost thing: Escape ends it before anything else.
    if (rulesPickRef.current?.cancel()) return;
    // An open dialog owns Escape: the first press closes it, a later one clears what it lit up.
    if (document.querySelector('[role="dialog"]')) return;
    // Then the side panels, which hold Escape the same way; then a pick in progress; then the ticket.
    if (showAnalysis) closeAnalysis();
    else if (showSuggestions) { setShowSuggestions(false); setHoveredSuggestion(null); }
    else if (showTickets) setShowTickets(false);
    else if (showRules) setShowRules(false);
    else if (pendingStop) cancelPick(); else setSelectedTicket(null);
  }; });
  // Ticket cards print on their own paper, so the print tree swaps to them, prints, and swaps back.
  useEffect(() => { queueMicrotask(() => { try { const stored = localStorage.getItem(PRINT_CHOICE_KEY); if (stored) setPrintChoice(JSON.parse(stored)); } catch { /* keep the default */ } }); }, []);
  const choosePrint = (choice: PrintChoice) => { setPrintChoice(choice); try { localStorage.setItem(PRINT_CHOICE_KEY, JSON.stringify(choice)); } catch { /* not remembered, still used */ } };
  // The dialog closes first, and print() waits until it has finished animating out and the page is no
  // longer locked for scrolling. Safari lays out its first preview the moment print() is called: with
  // the lock still on (body overflow hidden) it spilled sheets onto a second page, and came right only
  // when a setting in its dialog made it lay the page out again. Waiting is capped, so a dialog that
  // never leaves cannot stop the print.
  useEffect(() => {
    if (!printRequest) return;
    let frame = 0;
    const started = performance.now();
    const settled = () => !document.querySelector('[role="dialog"]') && !document.body.hasAttribute("data-scroll-locked") && getComputedStyle(document.body).overflow !== "hidden";
    // The ticket cards print on their own paper: the print tree has swapped to them, and needs two frames
    // for the styles applied after the swap, on top of waiting for the dialog.
    const frames = runParts.tickets ? 2 : 1;
    let seen = 0;
    const wait = () => {
      seen += 1;
      if ((seen >= frames && settled()) || performance.now() - started > 1500) { window.print(); setPrintScope("map"); return; }
      frame = requestAnimationFrame(wait);
    };
    frame = requestAnimationFrame(wait);
    return () => cancelAnimationFrame(frame);
    // printScope is read when the request arrives, not a reason to start the wait again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printRequest]);

  const hasContent = data.stops.length > 0 || data.routes.length > 0 || data.background.length > 0 || data.notes.length > 0 || Boolean(data.backgroundImage);
  const dismissGuide = () => { try { localStorage.setItem(GUIDE_SEEN_KEY, "1"); } catch { /* ignore unavailable storage */ } setShowGuide(false); };
  const applyGuideChoice = (map: MapData) => {
    change(() => cloneMap(map));
    clearSelection();
    setDraftPoints([]);
    setTool("select");
    dismissGuide();
    setDanger(null);
    // An empty map has nothing to look at, and the board format decides everything drawn on it, so
    // that is where a new map starts.
    if (!map.stops.length && !map.routes.length) openStyles({ kind: "map" });
  };
  const chooseFromGuide = (kind: "blank" | "example") => {
    if (hasContent) { setDanger(kind === "blank" ? "load-blank" : "load-example"); return; }
    applyGuideChoice(kind === "blank" ? emptyMap : initialMap);
  };

  const chooseStop = (id: string) => {
    if (tool === "route") {
      if (!routeStart) { setRouteStart(id); setPickTo(null); return; }
      if (routeStart === id) { setRouteStart(null); return; }
      change((draft) => { draft.routes.push({ id: `r-${Date.now()}`, a: routeStart, b: id, length: 2, type: routeType, color: routeColor, lineStyle: routeLineStyle, curved: routeCurved ? undefined : false }); return draft; });
      setRouteStart(null);
      return;
    }
    if (tool === "ticket") {
      if (!ticketStart) { setTicketStart(id); setPickTo(null); return; }
      if (ticketStart === id) { setTicketStart(null); return; }
      const path = shortestPath(adjacency, ticketStart, id);
      const points = path ? Math.max(1, Math.round(path.distance * ticketRate)) : 1;
      const ticketId = `t-${Date.now()}`;
      change((draft) => { draft.tickets.push({ id: ticketId, a: ticketStart, b: id, points, set: activeTicketSet.id }); return draft; });
      setTicketStart(null);
      setSelectedTicket(ticketId);
      if (!path) toast.warning(`${stopById(data, ticketStart)?.name} and ${stopById(data, id)?.name} are not connected. The ticket is added, but nobody can complete it yet.`);
      return;
    }
    if (tool === "measure") {
      if (!measureStart) { setMeasureStart(id); setMeasureResult(null); setPickTo(null); return; }
      if (measureStart === id) { setMeasureStart(null); return; }
      const path = shortestPath(adjacency, measureStart, id);
      setMeasureResult(path ? { from: measureStart, to: id, distance: path.distance, routeIds: path.routeIds } : { from: measureStart, to: id, unreachable: true });
      setMeasureStart(null);
      return;
    }
    setSelectedStop(id); setSelectedRoute(null); setSelectedBackground(null);
  };
  const finishBackground = () => {
    const minimum = backgroundType === "area" ? 3 : 2;
    if (draftPoints.length < minimum) return;
    const id = `bg-${Date.now()}`;
    const shape: BackgroundShape = { id, type: backgroundType, label: backgroundType === "area" ? "Area" : "Boundary", points: draftPoints, fill: backgroundFill, stroke: backgroundStroke, opacity: .65, strokeWidth: 3 };
    change((draft) => { draft.background.push(shape); return draft; });
    setDraftPoints([]); setSelectedBackground(id); setSelectedStop(null); setSelectedRoute(null); setTool("select");
  };
  const onCanvasDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const target = event.target as SVGElement;
    if (target !== event.currentTarget && !target.classList.contains("map-bg")) return;
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY, format.height);
    if (tool === "stop") {
      change((draft) => { draft.stops.push({ id: `s-${Date.now()}`, name: "New stop", type: stopType, size: stopSize, symbol: stopSymbol, letter: stopSymbol === "letter" ? stopLetter || "A" : undefined, ...point }); return draft; });
      return;
    }
    if (tool === "background") {
      if (backgroundType === "label") {
        const id = `bg-${Date.now()}`;
        change((draft) => { draft.background.push({ id, type: "label", label: "Label", points: [point], fill: "#000000", stroke: backgroundStroke, opacity: 1, strokeWidth: 0 }); return draft; });
        setSelectedBackground(id); setTool("select");
      } else setDraftPoints((points) => [...points, point]);
      return;
    }
    if (tool === "note") {
      const id = `note-${Date.now()}`;
      const width = 220, height = 110;
      change((draft) => { draft.notes.push({ id, x: point.x - width / 2, y: point.y - height / 2, width, height, text: "Evaluation note" }); return draft; });
      chooseNote(id);
      return;
    }
    clearSelection();
  };
  const onCanvasMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY, format.height);
    if (pendingStop) setPickTo(point);
    // Hold the pointer once a drag is under way, so it keeps reporting after it leaves the board.
    if (dragging() && !event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    if (dragNoteRef.current || dragImageRef.current || dragBackgroundLabelRef.current || dragBackgroundPointRef.current || dragWaypointRef.current || dragStopRef.current || dragStopLabelRef.current) draggedRef.current = true;
    if (dragNoteRef.current) {
      const drag = dragNoteRef.current;
      setData((current) => ({
        ...current,
        notes: current.notes.map((note) => {
          if (note.id !== drag.id) return note;
          if (drag.mode === "move") return { ...note, x: point.x - drag.offsetX, y: point.y - drag.offsetY };
          return { ...note, width: Math.max(90, point.x - note.x), height: Math.max(50, point.y - note.y) };
        }),
      }));
      setSaved(false); return;
    }
    if (dragImageRef.current) {
      const drag = dragImageRef.current;
      // A background image is placed against the board's edges, and may hang over them, so it moves
      // and scales by the raw pointer. Only a corner of it has to stay on the board, so it cannot be
      // dragged out of reach.
      const free = canvasPointRaw(event.currentTarget, event.clientX, event.clientY, format.height);
      setData((current) => {
        const img = current.backgroundImage;
        if (!img) return current;
        if (drag.mode === "move") return { ...current, backgroundImage: {
          ...img,
          x: Math.max(IMAGE_KEEP_ON_BOARD - img.width, Math.min(W - IMAGE_KEEP_ON_BOARD, free.x - drag.offsetX)),
          y: Math.max(IMAGE_KEEP_ON_BOARD - img.height, Math.min(format.height - IMAGE_KEEP_ON_BOARD, free.y - drag.offsetY)),
        } };
        if (drag.mode === "scale") return { ...current, backgroundImage: { ...img, width: Math.max(20, free.x - img.x), height: Math.max(20, free.y - img.y) } };
        const cx = img.x + img.width / 2, cy = img.y + img.height / 2;
        const rotation = Math.atan2(point.y - cy, point.x - cx) * 180 / Math.PI + 90;
        return { ...current, backgroundImage: { ...img, rotation } };
      });
      setSaved(false); return;
    }
    if (dragBackgroundLabelRef.current) {
      const shapeId = dragBackgroundLabelRef.current;
      setData((current) => ({ ...current, background: current.background.map((shape) => shape.id === shapeId ? { ...shape, labelPoint: point } : shape) }));
      setSaved(false); return;
    }
    if (dragBackgroundPointRef.current) {
      const target = dragBackgroundPointRef.current;
      setData((current) => ({ ...current, background: current.background.map((shape) => shape.id === target.shapeId ? { ...shape, points: shape.points.map((item, index) => index === target.index ? point : item) } : shape) }));
      setSaved(false); return;
    }
    if (dragWaypointRef.current) {
      const target = dragWaypointRef.current;
      setData((current) => {
        const placed = { x: point.x - target.grabOffset.x, y: point.y - target.grabOffset.y };
      const dragged = current.routes.find((route) => route.id === target.routeId);
        const linked = new Set((dragged && linkParallel ? current.routes.filter((route) => samePair(route, dragged)) : dragged ? [dragged] : []).map((route) => route.id));
        return { ...current, routes: current.routes.map((route) => linked.has(route.id) && (route.points?.length ?? 0) > target.index ? { ...route, points: (route.points ?? []).map((item, index) => index === target.index ? placed : item) } : route) };
      });
      setSaved(false); return;
    }
    if (dragStopLabelRef.current) {
      // The name goes where the pointer is, seen from the stop, to the whole degree. The stop itself
      // stays put, locked or not: the lock is about its position, not its name.
      const stopId = dragStopLabelRef.current;
      setData((current) => ({ ...current, stops: current.stops.map((stop) => {
        if (stop.id !== stopId) return stop;
        const angle = Math.round(Math.atan2(point.y - stop.y, point.x - stop.x) * 180 / Math.PI + 360) % 360;
        return { ...stop, labelAngle: angle };
      }) }));
      setSaved(false); return;
    }
    if (!dragStopRef.current) return;
    setData((current) => ({ ...current, stops: current.stops.map((stop) => stop.id === dragStopRef.current ? { ...stop, ...point } : stop) }));
    setSaved(false);
  };
  const dragging = () => Boolean(dragNoteRef.current || dragImageRef.current || dragBackgroundLabelRef.current || dragBackgroundPointRef.current || dragWaypointRef.current || dragStopRef.current || dragStopLabelRef.current);
  const stopDragging = () => {
    // Only a drag that actually moved something becomes an undo step — a plain click to select
    // sets the same refs and should not fill the history with no-ops.
    if (draggedRef.current && dragSnapshotRef.current) pushHistory(dragSnapshotRef.current);
    dragSnapshotRef.current = null;
    draggedRef.current = false;
    dragStopRef.current = null; dragStopLabelRef.current = null; dragWaypointRef.current = null; dragBackgroundPointRef.current = null; dragBackgroundLabelRef.current = null; dragImageRef.current = null; dragNoteRef.current = null;
  };
  const deleteSelected = () => {
    change((draft) => {
      if (imageSelected) draft.backgroundImage = undefined;
      if (selectedNote) draft.notes = draft.notes.filter((note) => note.id !== selectedNote);
      if (selectedBackground) draft.background = draft.background.filter((shape) => shape.id !== selectedBackground);
      if (selectedRoute) draft.routes = draft.routes.filter((route) => route.id !== selectedRoute);
      if (selectedStop) { draft.stops = draft.stops.filter((stop) => stop.id !== selectedStop); draft.routes = draft.routes.filter((route) => route.a !== selectedStop && route.b !== selectedStop); }
      return draft;
    });
    clearSelection(); setDanger(null);
  };
  const toggleLocomotiveSlot = (routeId: string, index: number) => {
    change((draft) => {
      const route = draft.routes.find((item) => item.id === routeId);
      if (!route) return draft;
      const slots = new Set(route.locomotiveSlots ?? []);
      if (slots.has(index)) slots.delete(index); else slots.add(index);
      route.locomotiveSlots = [...slots].sort((a, b) => a - b);
      return draft;
    });
  };

  // A classic double route: a second line between the same two stops, in a colour that pair does
  // not use yet. Both lines are drawn side by side automatically by parallelPoints.
  const addParallelRoute = (routeId: string) => {
    const id = `r-${Date.now()}`;
    change((draft) => {
      const source = draft.routes.find((item) => item.id === routeId);
      if (!source) return draft;
      const siblings = draft.routes.filter((item) => samePair(item, source));
      const used = new Set(siblings.map((item) => item.color));
      const colour = Object.keys(routeColors).find((key) => key !== "neutral" && !used.has(key)) ?? source.color;
      draft.routes.push({ ...source, id, color: colour, points: source.points?.map((point) => ({ ...point })) });
      return draft;
    });
    setSelectedRoute(id);
  };
  // Bending one line of a double route normally has to move the other with it, or the two stop
  // being parallel the moment you shape them. Unticking the link is how you split them up.
  const bendTargets = (draft: MapData, routeId: string) => {
    const route = draft.routes.find((item) => item.id === routeId);
    if (!route) return [];
    if (!linkParallel) return [route];
    return draft.routes.filter((item) => samePair(item, route));
  };
  const straightenRoute = (routeId: string) => change((draft) => { for (const route of bendTargets(draft, routeId)) route.points = undefined; return draft; });
  const applyRouteCurve = (routeId: string, curved: boolean) => change((draft) => { for (const route of bendTargets(draft, routeId)) route.curved = curved ? undefined : false; return draft; });
  const tidyLabels = () => {
    const { placed, unresolved, locked } = autoPlaceLabels(data);
    const lockedNote = locked.length ? ` ${locked.length} locked name${locked.length === 1 ? " was" : "s were"} left as ${locked.length === 1 ? "it is" : "they are"}: ${locked.map((id) => stopById(data, id)?.name).filter(Boolean).slice(0, 4).join(", ")}.` : "";
    if (!placed.size && !unresolved.length) { toast.success(locked.length ? `Nothing else to move.${lockedNote}` : "Every stop name is already clear of the routes."); return; }
    if (placed.size) change((draft) => { for (const stop of draft.stops) { const angle = placed.get(stop.id); if (angle !== undefined) stop.labelAngle = angle; } return draft; });
    const moved = `Moved ${placed.size} name${placed.size === 1 ? "" : "s"}, clear of the routes and of each other`;
    if (unresolved.length) {
      const names = unresolved.map((id) => stopById(data, id)?.name).filter(Boolean);
      toast.warning(`${moved}. ${unresolved.length} could not be placed: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}. Move the stop, bend the route away, or set those by hand.`);
    } else toast.success(`${moved}.${lockedNote}`);
  };
  const lockAllStops = (locked: boolean) => change((draft) => { for (const stop of draft.stops) stop.locked = locked || undefined; return draft; });
  const lockAllNames = (locked: boolean) => change((draft) => { for (const stop of draft.stops) stop.labelLocked = locked || undefined; return draft; });
  const insertRouteBend = (routeId: string, index: number, point: Point) => change((draft) => { for (const route of bendTargets(draft, routeId)) { const points = [...(route.points ?? [])]; points.splice(index, 0, { ...point }); route.points = points; } return draft; });
  const removeRouteBend = (routeId: string, index: number) => change((draft) => { for (const route of bendTargets(draft, routeId)) { if (!route.points) continue; const points = route.points.filter((_, item) => item !== index); route.points = points.length ? points : undefined; } return draft; });
  const addSuggestedRoute = (suggestion: RouteSuggestion) => change((draft) => { draft.routes.push({ id: `r-${Date.now()}`, a: suggestion.a, b: suggestion.b, length: suggestion.suggestedLength, type: routeType, color: suggestion.suggestedColor }); return draft; });
  const openStyles = (target: StyleTarget) => { setStyleTarget(target); setShowStyles(true); };
  const download = (blob: Blob, filenameBase: string, extension: string) => { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${filenameBase.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "map"}-${formatTimestamp()}.${extension}`; link.click(); URL.revokeObjectURL(url); };
  const downloadJson = (payload: unknown, filenameBase: string) => download(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), filenameBase, "json");
  const downloadCsv = (text: string, filenameBase: string) => download(new Blob([text], { type: "text/csv;charset=utf-8" }), filenameBase, "csv");
  const saveImage = (blob: Blob) => { setMakingImage(false); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${data.name}.png`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url); };
  const exportMap = () => downloadJson(writeMapFile("map", mapPayload(data), data), data.name);
  const exportBackground = () => downloadJson(writeMapFile("background", { format: data.format, background: data.background, backgroundImage: data.backgroundImage }, data), `${data.name} background`);
  const exportNetwork = () => downloadJson(writeMapFile("network", networkPayload(data), data), `${data.name} network`);
  const exportTickets = (scope: "set" | "all") => { const ids = scope === "all" ? data.ticketSets.map((set) => set.id) : [activeTicketSet.id]; downloadJson(writeMapFile("tickets", buildTicketFile(data, ids), data), `${data.name} ${scope === "all" ? "tickets" : activeTicketSet.label}`); };
  const exportTicketsCsv = (scope: "set" | "all") => downloadCsv(ticketsCsv(data, scope === "all" ? data.ticketSets.map((set) => set.id) : [activeTicketSet.id]), `${data.name} ${scope === "all" ? "tickets" : activeTicketSet.label}`);
  const printTickets = () => { setShowTickets(false); setPrintScope("deck"); setPrintRequest((count) => count + 1); };
  const applyBackgroundImport = (background: BackgroundShape[], backgroundImage?: BackgroundImage) => { change((draft) => ({ ...draft, background, backgroundImage })); clearSelection(); setDanger(null); setPendingImport(null); };
  const applyNetworkImport = (stops: Stop[], routes: Route[], lineStyles: LineStyle[], routeTypeStyles: RouteTypeStyle[], stopTypeStyles: StopTypeStyle[], wagonStyles: WagonStyle[], tickets: Ticket[]) => {
    change((draft) => {
      // Styles the file brought are added where this map has none by that id, so an imported
      // network keeps its junctions and tunnels without overwriting styles already set up here.
      const mergeStyles = <T extends { id: string }>(mine: T[], theirs: T[]) => [...mine, ...theirs.filter((style) => !mine.some((item) => item.id === style.id))];
      const next = { ...draft, stops, routes, lineStyles, routeTypeStyles,
        stopTypeStyles: mergeStyles(draft.stopTypeStyles, stopTypeStyles),
        wagonStyles: mergeStyles(draft.wagonStyles ?? [], wagonStyles) };
      // Tickets that came with the network go into the deck being worked on.
      if (tickets.length) next.tickets = [...draft.tickets.filter((ticket) => (ticket.set ?? draft.ticketSets[0].id) !== activeTicketSet.id), ...tickets.map((ticket) => ({ ...ticket, set: activeTicketSet.id }))];
      return next;
    });
    clearSelection(); setDanger(null); setPendingImport(null);
    if (tickets.length) toast.success(`${tickets.length} tickets came with the network and went into ${activeTicketSet.label}.`);
  };
  // Spreadsheets: stops and routes replace the network, tickets always arrive as new decks.
  const applyCsvImport = (result: CsvImport) => {
    change((draft) => ({ ...draft, ...(result.network ? { stops: result.stops, routes: result.routes } : {}), ticketSets: [...draft.ticketSets, ...result.sets], tickets: [...draft.tickets, ...result.tickets] }));
    if (result.network) clearSelection();
    setDanger(null); setPendingImport(null);
    if (result.sets.length) { setTicketSetId(result.sets[0].id); if (!result.network) openTickets(); }
    const read = [result.network && `${result.stops.length} stops`, result.network && `${result.routes.length} routes`, result.tickets.length && `${result.tickets.length} tickets`].filter(Boolean).join(", ");
    const said = result.warnings.join(" ");
    if (result.warnings.length) toast.warning(`Imported ${read}. ${said}`, { duration: 12000 }); else toast.success(`Imported ${read}.`);
  };
  const importCsv = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = await Promise.all([...list].map(async (file) => ({ name: file.name, text: await file.text() })));
    const result = readCsvImport(files, data);
    if (!result.stops.length && !result.routes.length && !result.tickets.length) { toast.error(result.warnings.join(" ") || "Nothing in those files could be read."); return; }
    if (result.network && (data.stops.length || data.routes.length)) { setPendingImport({ kind: "csv", result }); setDanger("import-csv"); }
    else applyCsvImport(result);
  };
  const applyImageImport = (image: BackgroundImage) => { change((draft) => ({ ...draft, backgroundImage: image })); chooseImage(); setDanger(null); setPendingImport(null); };
  const importMap = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = readMapFile(JSON.parse(String(reader.result)));
        const raw = parsed.payload as Record<string, never>;
        if (parsed.kind === "background") {
          const { background, backgroundImage } = normalizeBackgroundFile(raw, format.height);
          if (data.background.length || data.backgroundImage) { setPendingImport({ kind: "background", background, backgroundImage }); setDanger("import-background"); }
          else applyBackgroundImport(background, backgroundImage);
          return;
        }
        if (parsed.kind === "tickets") {
          const { sets, tickets, dropped } = normalizeTicketFile(raw, data);
          if (!tickets.length) { toast.error(dropped ? `None of the ${dropped} tickets in the file match a stop in this map.` : "That ticket file is empty."); return; }
          change((draft) => ({ ...draft, ticketSets: [...draft.ticketSets, ...sets], tickets: [...draft.tickets, ...tickets] }));
          setTicketSetId(sets[0].id);
          openTickets();
          toast.success(`${tickets.length} ticket${tickets.length === 1 ? "" : "s"} imported as ${sets.map((set) => set.label).join(", ")}.${dropped ? ` ${dropped} skipped: no matching stop.` : ""}`);
          return;
        }
        if (parsed.kind === "network") {
          const { stops, routes, lineStyles, routeTypeStyles, stopTypeStyles, wagonStyles, tickets } = normalizeNetworkFile(raw, format.height);
          if (data.stops.length || data.routes.length) { setPendingImport({ kind: "network", stops, routes, lineStyles, routeTypeStyles, stopTypeStyles, wagonStyles, tickets }); setDanger("import-network"); }
          else applyNetworkImport(stops, routes, lineStyles, routeTypeStyles, stopTypeStyles, wagonStyles, tickets);
          return;
        }
        const incoming = normalizeMap(raw);
        change(() => incoming);
        clearSelection();
      } catch (error) {
        // A file from a newer build says so in its own words; anything else is simply not ours.
        toast.error(error instanceof Error && error.message.includes("newer version") ? error.message : "The file could not be read as a map project.");
      }
    };
    reader.readAsText(file);
  };
  const importBackgroundImage = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { window.alert("Please choose a PNG, JPEG or WebP image."); return; }
    if (file.size > MAX_IMAGE_WARN_BYTES) toast.warning(`This image is about ${(file.size / (1024 * 1024)).toFixed(1)} MB. The saved map file will be large.`);
    try {
      const { dataUrl, naturalWidth, naturalHeight } = await readBackgroundImage(file);
      const scale = Math.min((W * 0.9) / naturalWidth, (format.height * 0.9) / naturalHeight, 1);
      const width = naturalWidth * scale;
      const height = naturalHeight * scale;
      const image: BackgroundImage = { dataUrl, naturalWidth, naturalHeight, x: (W - width) / 2, y: (format.height - height) / 2, width, height, rotation: 0, opacity: 1, crop: { top: 0, right: 0, bottom: 0, left: 0 } };
      if (data.backgroundImage) { setPendingImport({ kind: "image", image }); setDanger("import-image"); }
      else applyImageImport(image);
    } catch { window.alert("The image could not be read."); }
  };
  const changeFormat = (nextFormat: MapFormat) => {
    if (nextFormat === data.format) return;
    change((draft) => {
      return rescaleMapToFormat(draft, nextFormat);
    });
    setDraftPoints([]);
    clearSelection();
  };

  return <TooltipProvider delayDuration={0} disableHoverableContent><main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><BusFront /></span><div><p>Ticket to Ride</p><h1>Map prototypes – Print and draw</h1></div></div>
      <div className="map-title"><Label htmlFor="map-name" className="sr-only">Map name</Label><Input id="map-name" value={data.name} onChange={(event) => change((draft) => ({ ...draft, name: event.target.value }))} /><span className="save-state"><Check />{saved ? "Saved locally" : "Saving…"}</span></div>
      <div className="header-actions"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm"><CircleHelp />Help</Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => setShowGuide(true)}><CircleHelp />Getting started</DropdownMenuItem><DropdownMenuItem asChild><a href="./about"><BusFront />About Map prototypes</a></DropdownMenuItem><DropdownMenuItem asChild><a href="./whats-new"><Sparkles />What&apos;s new</a></DropdownMenuItem><DropdownMenuItem asChild><a href={REPO_URL} target="_blank" rel="noopener noreferrer"><Code />Source code on GitHub</a></DropdownMenuItem><DropdownMenuLabel className="version-label">Version {APP_VERSION}</DropdownMenuLabel></DropdownMenuContent></DropdownMenu><Button variant="ghost" size="icon" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!past.length} onClick={undo}><Undo2 /></Button><Button variant="ghost" size="icon" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!future.length} onClick={redo}><Redo2 /></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Upload />Import</Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => fileRef.current?.click()}><Upload />Map project</DropdownMenuItem><DropdownMenuItem onClick={() => fileRef.current?.click()}><TicketIcon />Tickets only</DropdownMenuItem><DropdownMenuItem onClick={() => imageFileRef.current?.click()}><ImageIcon />Background image</DropdownMenuItem><DropdownMenuItem onClick={() => csvFileRef.current?.click()}><FileSpreadsheet />Spreadsheet (CSV)</DropdownMenuItem></DropdownMenuContent></DropdownMenu><input ref={csvFileRef} hidden type="file" multiple accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(event) => { void importCsv(event.target.files); event.target.value = ""; }} /><input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => { importMap(event.target.files?.[0]); event.target.value = ""; }} /><input ref={imageFileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { importBackgroundImage(event.target.files?.[0]); event.target.value = ""; }} /><Button variant="outline" size="sm" onClick={() => setShowPrint(true)}><Printer />Print map</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm"><Download />Export</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={exportMap}><Download />Full map</DropdownMenuItem><DropdownMenuItem onClick={() => setMakingImage(true)}><ImageIcon />Map as image (PNG)</DropdownMenuItem><DropdownMenuItem onClick={exportBackground}><Layers3 />Background only</DropdownMenuItem><DropdownMenuItem onClick={exportNetwork}><Link2 />Network only</DropdownMenuItem><DropdownMenuItem onClick={() => exportTickets("all")}><TicketIcon />Tickets only</DropdownMenuItem><DropdownMenuSub><DropdownMenuSubTrigger><FileSpreadsheet />Spreadsheet (CSV)</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem onClick={() => exportTicketsCsv("all")}><TicketIcon />Tickets</DropdownMenuItem><DropdownMenuItem onClick={() => downloadCsv(routesCsv(data), `${data.name} routes`)}><RouteIcon />Routes</DropdownMenuItem><DropdownMenuItem onClick={() => downloadCsv(stopsCsv(data), `${data.name} stops`)}><MapPin />Stops</DropdownMenuItem><DropdownMenuItem onClick={() => downloadCsv(distancesCsv(data), `${data.name} distances`)}><Grid3x3 />Distances between stops</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub></DropdownMenuContent></DropdownMenu></div>
    </header>
    <div className={cn("workspace", widePanel && "showing-balance")} style={{ "--right-width": `${rightWidth}px`, "--map-ratio": W / format.height } as React.CSSProperties}>
      {widePanel && <div className="column-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the right column" aria-valuenow={rightWidth} aria-valuemin={RIGHT_WIDTH_MIN} aria-valuemax={RIGHT_WIDTH_MAX} tabIndex={0} title="Drag to resize, double-click to reset"
        onPointerDown={(event) => { event.preventDefault(); const startX = event.clientX, startWidth = rightWidth; const el = event.currentTarget; el.setPointerCapture(event.pointerId); const move = (e: PointerEvent) => resizeRight(startWidth + startX - e.clientX); const done = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", done); el.removeEventListener("pointercancel", done); }; el.addEventListener("pointermove", move); el.addEventListener("pointerup", done); el.addEventListener("pointercancel", done); }}
        onDoubleClick={resetRight}
        onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); resizeRight(rightWidth + 24); } else if (event.key === "ArrowRight") { event.preventDefault(); resizeRight(rightWidth - 24); } }} />}
      <aside className="tools-panel panel">
        <div className="panel-heading"><span>Tools</span><small>Work directly on the map</small></div>
        <div className="tool-row">{toolDefinitions.map((item) => <ToolButton key={item.id} active={tool === item.id} icon={item.icon} title={item.title} note={item.note} onClick={() => selectTool(item.id)} />)}</div>
        <div className="tool-panel">
          {tool === "route" && <p className="tool-status">{routeStart ? `Start: ${stopById(data, routeStart)?.name} · now click the destination stop` : "Click two stops to connect them."}</p>}
          {tool === "ticket" && <p className="tool-status">{ticketStart ? `From ${stopById(data, ticketStart)?.name} · now click the other end` : `Click two stops to make a ticket for ${activeTicketSet.label}. ${ticketsHere.length} so far.`}</p>}
          {tool === "measure" && <p className="tool-status">{measureStart ? `From ${stopById(data, measureStart)?.name} · now click the destination stop` : measureResult ? ("unreachable" in measureResult ? `${stopById(data, measureResult.from)?.name} → ${stopById(data, measureResult.to)?.name}: no connected path` : `${stopById(data, measureResult.from)?.name} → ${stopById(data, measureResult.to)?.name}: ${measureResult.distance} wagon spaces`) : "Click two stops for the shortest path."}</p>}
          {tool === "stop" && <div className="tool-options"><div className="grid-two"><div><Label>Stop type</Label><NativeSelect value={stopType} onChange={(event) => setStopType(event.target.value as StopType)}>{data.stopTypeStyles.map((meta) => <NativeSelectOption key={meta.id} value={meta.id}>{meta.label}</NativeSelectOption>)}</NativeSelect></div><div><Label>Stop size</Label><NativeSelect value={stopSize} onChange={(event) => setStopSize(event.target.value as StopSize)}>{Object.entries(stopSizeMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div></div><div className="grid-two"><div><Label>Symbol</Label><NativeSelect value={stopSymbol} onChange={(event) => setStopSymbol(event.target.value as StopSymbol)}>{Object.entries(stopSymbolMeta).map(([key, meta]) => <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>{stopSymbol === "letter" && <div><Label>Letter</Label><Input maxLength={2} value={stopLetter} onChange={(event) => setStopLetter(event.target.value)} /></div>}</div></div>}
          {tool === "route" && <div className="tool-options"><StylePicker label="Route type" value={routeType} styles={data.routeTypeStyles} placeholder="" onChange={(id) => id && setRouteType(id)} onEdit={() => openStyles({ kind: "route", id: routeType })} /><label className="checkbox-row"><input type="checkbox" checked={routeCurved} onChange={(event) => setRouteCurved(event.target.checked)} />Draw as a smooth curve</label><div><Label>Colour</Label><NativeSelect value={routeColor} onChange={(event) => setRouteColor(event.target.value)}>{Object.keys(routeColors).map((key) => <NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div></div>}
          {tool === "background" && <div className="tool-options background-tools"><div className="image-import-row"><Label>Background image</Label><div className="image-import-buttons"><Button size="sm" variant="outline" onClick={() => imageFileRef.current?.click()}><ImageIcon />{data.backgroundImage ? "Replace image" : "Import image"}</Button>{data.backgroundImage && <Button size="sm" variant="ghost" onClick={() => { chooseImage(); setDanger("delete"); }}><Trash2 />Remove</Button>}</div></div><Label>Object</Label><NativeSelect value={backgroundType} onChange={(event) => { setBackgroundType(event.target.value as BackgroundType); setDraftPoints([]); }}><NativeSelectOption value="area">Area</NativeSelectOption><NativeSelectOption value="line">Line</NativeSelectOption><NativeSelectOption value="label">Label</NativeSelectOption></NativeSelect>{backgroundType !== "label" && <><div className="colour-row"><label>Fill <input type="color" value={backgroundFill} onChange={(event) => setBackgroundFill(event.target.value)} disabled={backgroundType === "line"} /></label><label>Outline <input type="color" value={backgroundStroke} onChange={(event) => setBackgroundStroke(event.target.value)} /></label></div><p className="helper">Click to add points. Finish when the shape is ready.</p><div className="draft-actions"><Button size="sm" disabled={draftPoints.length < (backgroundType === "area" ? 3 : 2)} onClick={finishBackground}>Finish shape</Button><Button size="sm" variant="ghost" disabled={!draftPoints.length} onClick={() => setDraftPoints([])}>Cancel</Button></div></>}</div>}
        </div>
        {coveredNames.length > 0 && <Tooltip><TooltipTrigger asChild>
          <div className="crossing-card has-warning name-card" tabIndex={0}>
            <div className="crossing-icon"><AlertTriangle /></div>
            <div>
              <strong>{coveredNames.length} stop name{coveredNames.length === 1 ? "" : "s"} on a route</strong>
              <p>{coveredNames.slice(0, 3).map((stop) => stop.name).join(", ")}{coveredNames.length > 3 ? ` and ${coveredNames.length - 3} more` : ""}</p>
              <Button variant="outline" size="sm" onClick={tidyLabels}><Crosshair />Move {coveredNames.length} name{coveredNames.length === 1 ? "" : "s"} clear</Button>
            </div>
          </div>
        </TooltipTrigger><TooltipContent side="right" className="balance-tooltip">
          <p>A stop&apos;s name is drawn over a route line, which is hard to read in print.</p>
          <p>The button turns each name around its own stop, away from the routes and away from the other names. Stops with the fewest clear positions are placed first, and a name that already sits well is left alone.</p>
          <p>Any that cannot be placed are named afterwards, so you can move the stop, bend the route away, or set those by hand with <strong>Name position</strong>.</p>
        </TooltipContent></Tooltip>}
        <Tooltip><TooltipTrigger asChild>
          <div className={cn("crossing-card", crossings.length && "has-warning")} tabIndex={0}><div className="crossing-icon">{crossings.length ? <AlertTriangle /> : <Check />}</div><div><strong>{crossings.length ? `${crossings.length} crossing${crossings.length === 1 ? "" : "s"}` : "No crossings"}</strong><p>{crossings.length ? "between buildable routes" : "The route network is geometrically clean"}</p></div></div>
        </TooltipTrigger><TooltipContent side="right" className="balance-tooltip">
          <p><strong>Crossings</strong> are places where two buildable routes pass over each other without meeting at a stop.</p>
          <p>Aim for zero. On a printed board a crossing is ambiguous: players can&apos;t tell which line a marked wagon space belongs to, and it usually means the geometry needs a stop at the junction or a route routed around.</p>
          <p>Drag a stop, or add a bend point to a selected route, to pull the lines apart. Pre-built infrastructure routes are ignored here, since those are drawn as continuous lines that nobody claims.</p>
        </TooltipContent></Tooltip>
        {data.stops.length > 0 && <Tooltip><TooltipTrigger asChild>
          {/* The card names the first few; pointing at it lists every one. */}
          <Tooltip><TooltipTrigger asChild>{<div className={cn("crossing-card", lowConnectionStops.length && "has-warning")} tabIndex={0}><div className="crossing-icon">{lowConnectionStops.length ? <AlertTriangle /> : <Check />}</div><div><strong>{lowConnectionStops.length ? `${lowConnectionStops.length} low-connection stop${lowConnectionStops.length === 1 ? "" : "s"}` : "Well connected"}</strong><p>avg hub degree {avgHubDegree.toFixed(1)}{lowConnectionStops.length ? ` · ${lowConnectionStops.slice(0, 4).map((stop) => stop.name).join(", ")}${lowConnectionStops.length > 4 ? ` and ${lowConnectionStops.length - 4} more` : ""}` : ""}</p></div></div>}</TooltipTrigger>
            {lowConnectionStops.length > 0 && <TooltipContent side="right" className="balance-tooltip"><strong>Fewer than two neighbours</strong><p>{lowConnectionStops.map((stop) => stop.name).join(", ")}</p></TooltipContent>}</Tooltip>
        </TooltipTrigger><TooltipContent side="right" className="balance-tooltip">
          <p><strong>Hub degree</strong> is a stop&apos;s direct neighbours plus the routes touching it, so a stop on two routes scores 4. Two parallel routes to the same neighbour count twice.</p>
          <p>Aim to give every stop at least two neighbours — a stop on a single route is a dead end that one player can block off. Across a whole map, an average of roughly 4–6 gives players choices without turning the board into a mesh.</p>
          <p>Drawing and deleting routes moves it; placing stops you never connect drags the average down.</p>
        </TooltipContent></Tooltip>}
        <Button variant="outline" size="sm" className="analyze-button" onClick={() => openStyles({ kind: "map" })}><Settings2 />Settings</Button>
        {data.stops.length > 0 && <Button variant="outline" size="sm" className="analyze-button" onClick={() => { setShowSuggestions(false); setHoveredSuggestion(null); setShowTickets(false); setShowRules(false); setShowAnalysis(true); }}><BarChart3 />Analyze balance</Button>}
        <Button variant="outline" size="sm" className="analyze-button" title={ticketButtonLabel} onClick={openTickets}><TicketIcon /><span className="button-label">{ticketButtonLabel}</span></Button>
        <Button variant="outline" size="sm" className="analyze-button" onClick={openRules}><ScrollText />Rules</Button>
        {data.stops.length > 1 && <Button variant="outline" size="sm" className="analyze-button" onClick={() => { closeAnalysis(); setShowTickets(false); setShowRules(false); setShowSuggestions(true); }}><Lightbulb />Suggest routes</Button>}
        <div className="legend"><p className="eyebrow">Stop types</p>{data.stopTypeStyles.map((meta) => <button type="button" key={meta.id} className="legend-item" title={`Edit the ${meta.label} stop type`} onClick={() => openStyles({ kind: "stop", id: meta.id })}><i style={{ background: meta.fill, borderColor: meta.stroke }} />{meta.label}</button>)}</div>
        <Button variant="ghost" className="reset-button" onClick={() => setDanger("reset")}><RotateCcw />Clear map</Button>
      </aside>
      <section className="map-wrap">
        {litTicket && <div className="highlight-chip"><TicketIcon /><span>{stopById(data, litTicket.a)?.name} → {stopById(data, litTicket.b)?.name}</span><Button variant="ghost" size="icon" aria-label="Stop showing this ticket" onClick={() => setSelectedTicket(null)}><X /></Button></div>}
        <div className="map-status"><Badge variant="secondary">{format.shortLabel}</Badge><Badge variant="secondary">{format.widthMm.toLocaleString("en-GB")} × {format.heightMm.toLocaleString("en-GB")} mm</Badge><Badge variant="secondary">{data.stops.length} stops</Badge><Badge variant="secondary">{data.routes.length} routes</Badge><Badge variant="secondary">{data.background.length} background objects</Badge>{data.notes.length > 0 && <Badge variant="secondary">{data.notes.length} note{data.notes.length === 1 ? "" : "s"}</Badge>}<span>Everything is stored in the exported map file</span></div>
        {hint && hint.atTop && <MapHint atTop title={hint.title} open={routeHintOpen} onToggle={toggleRouteHint} offsetX={routeHintX} onOffsetChange={moveRouteHint}>{hint.body}</MapHint>}
        <svg className={cn("map-canvas", `tool-${tool}`, hasMarks && "has-marks", rulesPicking && "picking-rules")} style={{ aspectRatio: `${W} / ${format.height}` }} viewBox={`0 0 ${W} ${format.height}`} onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={stopDragging} onPointerCancel={stopDragging}>
          <MapArtwork data={data} tool={tool} highlightRoutes={highlightRoutes} scaleWidthMm={scaleWidthMm} selectedRoute={selectedRoute} selectedStop={selectedStop} selectedBackground={selectedBackground} imageSelected={imageSelected} selectedNote={selectedNote} bottleneckRoutes={showAnalysis ? bottleneckRoutes : undefined} pendingStop={pendingStop} pickTo={pickTo} previewRoutes={balanceRoutes ?? pinnedRoutes ?? preview?.routes} previewStop={balanceStop ?? pin?.stop ?? null} previewLabel={preview?.label ?? null} onStopHover={setHoveredStop} draft={{ type: backgroundType, points: draftPoints, fill: backgroundFill, stroke: backgroundStroke }} onRoute={(id) => { setSelectedRoute(id); setSelectedStop(null); setSelectedBackground(null); setSelectedNote(null); setTool("select"); }} onRouteSlot={toggleLocomotiveSlot} onRouteBendInsert={insertRouteBend} onRouteBendRemove={removeRouteBend} onStop={(id, shiftHeld) => { if (rulesPickRef.current?.stop(id)) return; chooseStop(id); if (tool === "select" && (shiftHeld || !stopById(data, id)?.locked)) { beginDrag(); dragStopRef.current = id; } }} onWaypoint={(routeId, index, grabOffset) => { beginDrag(); dragWaypointRef.current = { routeId, index, grabOffset }; }} onBackground={(id) => { setSelectedBackground(id); setSelectedRoute(null); setSelectedStop(null); setSelectedNote(null); setTool("select"); }} onBackgroundPoint={(shapeId, index) => { beginDrag(); dragBackgroundPointRef.current = { shapeId, index }; }} onBackgroundLabel={(shapeId) => { beginDrag(); dragBackgroundLabelRef.current = shapeId; }} onImageSelect={chooseImage} onImageMove={(point) => { chooseImage(); const img = data.backgroundImage; if (img) { beginDrag(); dragImageRef.current = { mode: "move", offsetX: point.x - img.x, offsetY: point.y - img.y }; } }} onImageScale={() => { beginDrag(); dragImageRef.current = { mode: "scale" }; }} onImageRotate={() => { beginDrag(); dragImageRef.current = { mode: "rotate" }; }} suggestionPreview={hoveredSuggestion ? (() => { const a = stopById(data, hoveredSuggestion.a), b = stopById(data, hoveredSuggestion.b); return a && b ? { a, b } : undefined; })() : undefined} onStopLabel={(id, shiftHeld) => { if (rulesPickRef.current?.stop(id)) return; chooseStop(id); if (shiftHeld || !stopById(data, id)?.labelLocked) { beginDrag(); dragStopLabelRef.current = id; } }} onNoteSelect={chooseNote} onNoteMove={(id, point) => { chooseNote(id); const note = data.notes.find((item) => item.id === id); if (note) { beginDrag(); dragNoteRef.current = { id, mode: "move", offsetX: point.x - note.x, offsetY: point.y - note.y }; } }} onNoteResize={(id) => { beginDrag(); dragNoteRef.current = { id, mode: "resize" }; }} onNoteToggle={(id) => change((draft) => { const note = draft.notes.find((item) => item.id === id); if (note) note.collapsed = !note.collapsed || undefined; return draft; })} />
        </svg>
        {hint && !hint.atTop && <MapHint atTop={false} title={hint.title} open={routeHintOpen} onToggle={toggleRouteHint} offsetX={routeHintX} onOffsetChange={moveRouteHint}>{hint.body}</MapHint>}
      </section>
      <aside className={cn("properties panel", showSuggestions && "showing-suggestions", widePanel && "showing-balance")}>
        {showAnalysis && <AnalysisPanel lengthView={lengthsView} setup={setup} bottlenecks={deckReport.bottlenecks} atTable={atTable} onAtTable={(count) => { setBottleneckTable(count); setBottleneckRoutes(new Set()); }} onShowBottleneck={(routeIds) => setBottleneckRoutes((current) => (routeIds.length === current.size && routeIds.every((id) => current.has(id)) ? new Set() : new Set(routeIds)))} bottleneckShown={bottleneckRoutes} pinKey={pin?.key ?? null} onPin={togglePin} onClose={closeAnalysis} onPreviewRoutes={(routeIds) => setBalanceRoutes(routeIds ? new Set(routeIds) : null)} onPreviewStop={setBalanceStop} data={data} stats={stats} colourTable={colourTable} spacing={spacing} scaleWidthMm={scaleWidthMm} onSelectRoute={(routeId) => { closeAnalysis(); setSelectedRoute(routeId); setSelectedStop(null); setSelectedBackground(null); setSelectedNote(null); setImageSelected(false); setTool("select"); }} onSelectStop={(stopId) => { closeAnalysis(); setSelectedStop(stopId); setSelectedRoute(null); setSelectedBackground(null); setSelectedNote(null); setImageSelected(false); setTool("select"); }}  />}
        {showTickets && <TicketsPanel compare={compareView} onHoverTicket={setHoveredTicket} lengthView={lengthsView} wide={rightWidth >= RIGHT_WIDTH_WIDE} onToggleWide={() => (rightWidth >= RIGHT_WIDTH_WIDE ? resetRight() : resizeRight(RIGHT_WIDTH_WIDE))} onClose={() => setShowTickets(false)} data={data} reviews={ticketReviews} coverage={ticketCoverage(data, activeTicketSet.id)} rate={ticketRate} selected={selectedTicket} activeSet={activeTicketSet} onSelect={setSelectedTicket}
          onSelectSet={(setId) => { setTicketSetId(setId); setSelectedTicket(null); }}
          onAddSet={() => { const id = `ts-${Date.now()}`; change((draft) => { draft.ticketSets.push({ id, label: nextDeckLabel(draft.ticketSets) }); return draft; }); setTicketSetId(id); setSelectedTicket(null); }}
          onDuplicateSet={() => { const id = `ts-${Date.now()}`; const stamp = Date.now(); change((draft) => { draft.ticketSets.push({ id, label: nextDeckLabel(draft.ticketSets, `${activeTicketSet.label} copy`) }); ticketsInSet(draft, activeTicketSet.id).forEach((ticket, index) => draft.tickets.push({ ...ticket, id: `t-${stamp}-${index}`, set: id })); return draft; }); setTicketSetId(id); setSelectedTicket(null); }}
          onRenameSet={(label) => change((draft) => { const set = draft.ticketSets.find((item) => item.id === activeTicketSet.id); if (set) set.label = label; return draft; })}
          onDeleteSet={() => { if (data.ticketSets.length < 2) return; const gone = activeTicketSet.id; change((draft) => { const first = draft.ticketSets[0].id; draft.tickets = draft.tickets.filter((ticket) => (ticket.set ?? first) !== gone); draft.ticketSets = draft.ticketSets.filter((set) => set.id !== gone); return draft; }); setTicketSetId(data.ticketSets.find((set) => set.id !== gone)!.id); setSelectedTicket(null); }}
          onExport={exportTickets} onExportCsv={exportTicketsCsv} onImport={() => fileRef.current?.click()} onPrint={printTickets} onStartFrom={startTicketFrom} onSuggest={openSuggest}
          onUpdate={(ticketId, values) => change((draft) => { const ticket = draft.tickets.find((item) => item.id === ticketId); if (ticket) Object.assign(ticket, { ...values, long: values.long === false ? undefined : values.long ?? ticket.long }); return draft; })}
          onDelete={(ticketId) => { change((draft) => { draft.tickets = draft.tickets.filter((item) => item.id !== ticketId); return draft; }); setSelectedTicket((current) => current === ticketId ? null : current); }}  />}
        {showRules && <RulesPanel pickRef={rulesPickRef} onPicking={setRulesPicking} data={data} wide={rightWidth >= RIGHT_WIDTH_WIDE} onToggleWide={() => (rightWidth >= RIGHT_WIDTH_WIDE ? resetRight() : resizeRight(RIGHT_WIDTH_WIDE))} onClose={() => setShowRules(false)} onChange={(text) => change((draft) => ({ ...draft, rules: text.trim() ? text : undefined }))} hover={{ stop: setBalanceStop, routes: (ids) => setBalanceRoutes(ids ? new Set(ids) : null) }} />}
        {showSuggestions && <SuggestionsPanel suggestions={suggestions} onAdd={addSuggestedRoute} onHover={setHoveredSuggestion} onClose={() => { setShowSuggestions(false); setHoveredSuggestion(null); }} />}
        <div className="panel-heading"><span>{tool === "ticket" ? "Ticket coverage" : "Properties"}</span><small title={tool === "ticket" ? activeTicketSet.label : undefined}>{tool === "ticket" ? `${activeTicketSet.label} · ${ticketsHere.length} ticket${ticketsHere.length === 1 ? "" : "s"}` : imageSelected ? "Background image selected" : selectedN ? "Note selected" : selectedB ? "Background object selected" : selectedR ? "Route selected" : selectedS ? "Stop selected" : "Select an object on the map"}</small></div>
        {tool === "ticket" && <TicketCoveragePanel rows={coverageRows} deck={activeTicketSet.label} cuts={bandCuts(ticketDiameter, bandsOf(data))} onEditMix={() => openStyles({ kind: "ticket" })} sort={coverageSort} onSort={setCoverageSort} onlyUncovered={onlyUncovered} onOnlyUncovered={setOnlyUncovered} onOpen={(stopId, band) => setStopTicketView({ stopId, band })} />}
        {tool !== "ticket" && !imageSelected && !selectedN && !selectedB && !selectedR && !selectedS && <div className="empty-state"><CircleDot /><p>Edit names, types, colours, geometry and route length here.</p></div>}
        {selectedN && <NoteProperties note={selectedN} change={change} onDelete={() => setDanger("delete")} />}
        {imageSelected && data.backgroundImage && <BackgroundImageProperties image={data.backgroundImage} formatHeight={format.height} change={change} onDelete={() => setDanger("delete")} />}
        {selectedB && <BackgroundProperties shape={selectedB} change={change} onDelete={() => setDanger("delete")} />}
        {selectedS && <StopProperties stop={selectedS} change={change} onDelete={() => setDanger("delete")} labelState={selectedLabelState} stopTypeStyles={data.stopTypeStyles} onEditStyles={openStyles} mapEndGapMm={data.endGapMm ?? DEFAULT_END_GAP_MM} allLocked={data.stops.length > 0 && data.stops.every((item) => item.locked)} onLockAll={lockAllStops} allNamesLocked={data.stops.length > 0 && data.stops.every((item) => item.labelLocked)} onLockAllNames={lockAllNames} tickets={stopTickets} onOpenTicket={openTicket} />}
        {selectedR && <RouteProperties route={selectedR} stops={data.stops} routes={data.routes} routeTypeStyles={data.routeTypeStyles} change={change} onDelete={() => setDanger("delete")} onAddParallel={addParallelRoute} onEditStyles={openStyles} onStraighten={straightenRoute} onSetCurved={applyRouteCurve} linkParallel={linkParallel} onLinkParallel={setLinkParallel} />}
      </aside>
    </div>
    <AlertDialog open={danger !== null} onOpenChange={(open) => { if (!open) { setDanger(null); setPendingImport(null); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{danger === "reset" ? "Clear the entire map?" : danger === "load-blank" ? "Replace the current map with a blank one?" : danger === "load-example" ? "Replace the current map with the example?" : danger === "import-background" ? "Replace the background?" : danger === "import-network" ? "Replace stops and routes?" : danger === "import-image" ? "Replace the background image?" : danger === "import-csv" ? "Replace stops and routes?" : "Delete the selected object?"}</AlertDialogTitle><AlertDialogDescription>{danger === "reset" ? "All locally stored background objects, stops and routes will be removed. Export the map first if you want to keep it." : danger === "load-blank" ? "Your current background objects, stops and routes will be replaced with a blank map. Export the map first if you want to keep your work." : danger === "load-example" ? "Your current background objects, stops and routes will be replaced with the neutral example map. Export the map first if you want to keep your work." : danger === "import-background" ? "The imported background, including any background image, will replace the current one. Stops and routes are kept as they are." : danger === "import-network" ? "The imported stops and routes will replace the current network, and any tickets in the file replace the deck you are working in. Background objects are kept as they are." : danger === "import-image" ? "The new image will replace the current background image." : danger === "import-csv" ? "The stops and routes in the spreadsheet will replace the current network. Tickets in it arrive as new decks, beside the ones you have. Background objects are kept as they are." : selectedStop ? "The stop and all connected routes will be deleted." : "The selected object will be deleted."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (danger === "reset") { change(() => cloneMap(emptyMap)); clearSelection(); setDanger(null); } else if (danger === "load-blank") applyGuideChoice(emptyMap); else if (danger === "load-example") applyGuideChoice(initialMap); else if (danger === "import-background" && pendingImport?.kind === "background") applyBackgroundImport(pendingImport.background, pendingImport.backgroundImage); else if (danger === "import-network" && pendingImport?.kind === "network") applyNetworkImport(pendingImport.stops, pendingImport.routes, pendingImport.lineStyles, pendingImport.routeTypeStyles, pendingImport.stopTypeStyles, pendingImport.wagonStyles, pendingImport.tickets); else if (danger === "import-image" && pendingImport?.kind === "image") applyImageImport(pendingImport.image); else if (danger === "import-csv" && pendingImport?.kind === "csv") applyCsvImport(pendingImport.result); else deleteSelected(); }}>Continue</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <StopTicketsDialog open={stopTicketView !== null} onOpenChange={(open) => { if (!open) setStopTicketView(null); }}
      stopName={stopTicketView ? stopById(data, stopTicketView.stopId)?.name ?? "" : ""} band={stopTicketView?.band ?? null} tickets={viewedStopTickets}
      onOpen={(ticketId) => { setStopTicketView(null); openTicket(ticketId); }} />
    <SuggestTicketsDialog open={showSuggest} onOpenChange={setShowSuggest} data={data} current={currentDeckReport} suggestion={suggestion}
      style={suggestChoice} onStyle={(value) => { setSuggestStyle(value); setSuggestSize(null); }}
      wagons={data.wagonsPerPlayer ?? DEFAULT_WAGONS_PER_PLAYER} onWagons={(value) => change((draft) => { draft.wagonsPerPlayer = value; return draft; })}
      deckSize={suggestSize ?? suggestDefaultSize} onDeckSize={setSuggestSize}
      keepExisting={suggestKeep} onKeepExisting={setSuggestKeep}
      busy={suggestBusy} deckName={suggestName} onDeckName={setSuggestName} currentDeck={activeTicketSet.label}
      onShuffle={() => setSuggestSeed((seed) => seed + 1)} onApply={(mode) => applySuggestion(mode, `ts-${Date.now()}`)} />
    <WelcomeGuide open={showGuide} onOpenChange={(open) => !open && dismissGuide()} onChooseBlank={() => chooseFromGuide("blank")} onChooseExample={() => chooseFromGuide("example")} />
    <SettingsDialog open={showStyles} onOpenChange={setShowStyles} target={styleTarget} onTarget={setStyleTarget} data={data} change={change} onChangeFormat={changeFormat} defaults={{ stopType, setStopType, stopSize, setStopSize: (value) => setStopSize(value as StopSize), routeType, setRouteType, routeColor, setRouteColor, routeCurved, setRouteCurved, routeLineStyle, setRouteLineStyle, linkParallel, setLinkParallel }} />
    <PrintPages data={data} plan={printPlan(data.format, printChoice, printProfile)} parts={runParts} setId={activeTicketSet.id} />
    {makingImage && <ImageStage data={data} onDone={saveImage} onFail={() => setMakingImage(false)} />}
    <PrintDialog open={showPrint} onOpenChange={setShowPrint} format={data.format} profile={printProfile} choice={printChoice} onChoice={choosePrint} parts={{ value: printPartsNow, onChange: choosePrintParts, rulesWritten: Boolean(data.rules?.trim()), ticketCount: ticketsHere.length, deckLabel: activeTicketSet.label }} onPrint={() => { setShowPrint(false); setPrintRequest((count) => count + 1); }} />
  </main></TooltipProvider>;
}

const toolDefinitions: Array<{ id: Tool; icon: React.ReactNode; title: string; note: string }> = [
  { id: "select", icon: <MousePointer2 />, title: "Select & move", note: "Click anything on the map to select it, then edit it in the Properties panel or drag it somewhere else." },
  { id: "stop", icon: <MapPinPlus />, title: "Add stop", note: "Click the map to place a stop, using the type, size and symbol set below." },
  { id: "route", icon: <Link2 />, title: "Draw route", note: "Click two stops to connect them, using the route type, colour and special-rule style set below." },
  { id: "background", icon: <Layers3 />, title: "Draw background", note: "Draw areas, boundaries and labels behind the network, or import a background map image." },
  { id: "note", icon: <StickyNote />, title: "Add note", note: "Click the map to drop an evaluation note. Notes show on screen, in print and in the PNG, but aren't part of the map itself." },
  { id: "ticket", icon: <TicketIcon />, title: "Add ticket", note: "Click two stops to make a destination ticket between them. The points are suggested from the shortest path and from what this map's other tickets are worth." },
  { id: "measure", icon: <Ruler />, title: "Measure distance", note: "Click two stops to see the shortest path between them, counted in wagon spaces rather than straight-line distance." },
];

// A zero-height sticky slot so the hint stays in view even when the board is taller than the
// window, without pushing the canvas around when a route is selected.
function MapHint({ atTop, title, open, onToggle, offsetX, onOffsetChange, children }: { atTop: boolean; title: string; open: boolean; onToggle: () => void; offsetX: number; onOffsetChange: (value: number) => void; children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number } | null>(null);
  // Only the grip is draggable; the rest of the box stays click-through so the map underneath
  // keeps working.
  const grip = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: offsetX };
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const box = boxRef.current;
      const scrollport = box?.parentElement?.parentElement;
      const limit = box && scrollport ? Math.max(0, (scrollport.clientWidth - box.offsetWidth) / 2 - 6) : 0;
      onOffsetChange(Math.max(-limit, Math.min(limit, drag.startOffset + event.clientX - drag.startX)));
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    },
  };
  // The collapsed bar can be parked further out than the expanded box fits, so re-clamp whenever
  // the box changes size or the window does.
  useEffect(() => {
    const clamp = () => {
      const box = boxRef.current;
      const scrollport = box?.parentElement?.parentElement;
      if (!box || !scrollport) return;
      const limit = Math.max(0, (scrollport.clientWidth - box.offsetWidth) / 2 - 6);
      if (Math.abs(offsetX) > limit) onOffsetChange(Math.max(-limit, Math.min(limit, offsetX)));
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [open, offsetX, onOffsetChange]);
  const shift = { transform: `translateX(${offsetX}px)` };
  return <div className={cn("map-hint-slot", atTop && "at-top", !open && "collapsed")}>
    {open
      ? <div className="map-hint" ref={boxRef} style={shift}>
        <span className="map-hint-grip" title="Drag to move the box sideways" {...grip}><GripVertical /></span>
        <button type="button" className="map-hint-toggle" onClick={onToggle} aria-label="Collapse the help"><ChevronDown /></button>
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
      : <div className="map-hint-bar" ref={boxRef} style={shift}>
        <span className="map-hint-grip" title="Drag to move the bar sideways" {...grip}><GripVertical /></span>
        <button type="button" onClick={onToggle}><ChevronUp />{title} · show the shortcuts</button>
      </div>}
  </div>;
}

function ToolButton({ active, icon, title, note, onClick }: { active: boolean; icon: React.ReactNode; title: string; note: string; onClick: () => void }) {
  return <Tooltip><TooltipTrigger asChild>
    <button type="button" className={cn("tool-button", active && "active")} onClick={onClick} aria-label={title} aria-pressed={active}>{icon}</button>
  </TooltipTrigger><TooltipContent side="bottom" sideOffset={6} className="tool-tooltip"><strong>{title}</strong><span>{note}</span></TooltipContent></Tooltip>;
}

// A fresh deck name that does not clash with the ones already in the map.
function nextDeckLabel(sets: TicketSet[], base = "Deck"): string {
  const used = new Set(sets.map((set) => set.label.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let attempt = 2;
  while (used.has(`${base} ${attempt}`.toLowerCase())) attempt += 1;
  return `${base} ${attempt}`;
}
