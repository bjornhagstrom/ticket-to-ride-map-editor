import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RouteLogo } from "../logo";
import { APP_VERSION, FILE_VERSION, LYING_FILE_VERSION } from "../map-storage";
import { REPO_URL } from "../version";
import "../about.css";

export const metadata = { title: "About – Ticket to Ride – Map prototypes" };

// README.md tells the same story on GitHub, section by section under the same headings;
// tests/releases.cjs checks that every heading here is there too. Change them together.
export default function About() {
  return <main className="about">
    <header className="about-head">
      <RouteLogo className="brand-mark" />
      <div>
        <p>Ticket to Ride</p>
        <h1>Map prototypes</h1>
      </div>
      <Link className="about-back" href="/"><ArrowLeft />Back to the editor</Link>
    </header>

    <section>
      <h2>What this is for</h2>
      <p>
        A workshop for maps that do not exist yet. You draw a board, place the stops, connect them
        with routes, work out a deck of destination tickets, and print the result on paper. Then you
        play on it with a highlighter pen: each player takes a colour and fills in the wagon spaces
        they claim. When the game is over you have a marked-up sheet showing what was fought over
        and what nobody touched, which is the part that tells you what to change.
      </p>
      <p>
        Two things make that feel like a real game rather than a sketch. Keep each player&apos;s
        wagons in front of them from a real set, and put one back in the box for every space they
        fill in: the pile in front of them is then exactly how many they have left, which is the
        pressure the game runs on. And if you print the board at full size — the sheets are trimmed at
        their marks and butted edge to edge — the spaces are the size of real wagons, so you can
        lay the plastic trains on the paper instead of drawing at all.
      </p>
      <p>
        It is meant for the stretch before a map is any good — the many many prototypes where
        the question is whether the network hangs together at all, not whether the artwork is right.
        It is free and unofficial, and runs in your browser: no account and nothing to install.
        Nothing leaves your browser either: the map you are working on is stored locally, and files
        move by export and import.
      </p>
      <figure>
        <img src="/ttr/images/about-editor.jpg" width={1600} height={900} alt="The editor with its example map: stops, coloured routes, a lake and a river, with the tools on the left" />
        <figcaption>The editor with its example map. The tools are on the left, the map in the middle, and what you select is edited on the right.</figcaption>
      </figure>
      <p>
        There is <a href="https://youtu.be/AS7XWDRvOEE" target="_blank" rel="noopener noreferrer">a tour of the editor in 80 seconds</a> on
        YouTube, from drawing a map to playing it on paper.
      </p>
    </section>

    <section>
      <h2>Wagon spaces are real size</h2>
      <p>
        A wagon space is drawn at the size a real 20 × 9 mm train takes up on a 790 mm board, with
        the spacing measured from a hundred real routes. So a route that is six spaces long has room
        for six actual plastic trains when you print at full size. If a route is drawn too short for
        the number of spaces you gave it, Map balance says so, in millimetres.
      </p>
    </section>

    <section>
      <h2>Boards, cards and spreadsheets</h2>
      <p>
        A board lies or stands, in the standard 2×3 or the extended 2×4. Standing it up or laying it
        down turns everything on it a quarter turn without changing a single distance, so the wagons
        and every number the editor gives stay as they were.
      </p>
      <p>
        The ticket cards print to be cut out, lying or standing as the board does, and each carries a
        small map of the whole board with its two stops ringed and joined by a line, as the real cards
        do.
      </p>
      <p>
        The tickets, the routes, the stops and the distance between every two stops can go out to a
        spreadsheet, and stops, routes and tickets can come back in from one: an export of your own, or
        a list typed by hand. Stops that come without a position are laid out from the routes, ready to
        be dragged into place.
      </p>
    </section>

    <section>
      <h2>Print, play, print again</h2>
      <p>
        One print run takes the board, the ticket cards and the rules, or any of them. The board goes
        on a single A4 or Letter sheet for a quick game, one sheet per fold panel, or at full size
        across as many sheets as it takes. The rules can also be printed from the Rules panel on their
        own, and a page of the balance figures can go with them, so a printed or saved milestone says
        what the editor thought of the map at the time. The same dialog saves it all as a PDF.
      </p>
      <figure>
        <img src="/ttr/images/about-cards.png" width={1089} height={546} alt="Six printed ticket cards, each with its two cities, a small map of the board with the two stops ringed and joined, and its points" />
        <figcaption>Ticket cards as they print, ready to cut: a small map of the board on each, as on the real cards.</figcaption>
      </figure>
      <p>
        Then you play, look at the marked-up sheet, change the map and print again. Every print and
        export after a change gets the map&apos;s next version number, on every sheet and every card,
        so the sheets from several playtests never get mixed up. A yellow playtest box on the board
        has a line for the date you played it; the players&apos; names go on the back of the sheet.
      </p>
    </section>
    <section>
      <h2>Where the numbers come from</h2>
      <p>
        The advice the editor gives is not invented. It is measured against fifteen official Ticket
        to Ride maps, transcribed route by route and ticket by ticket, eight of which are complete
        and consistent enough to calibrate against: the original USA map, Europe, Nordic Countries,
        India, Switzerland, Old West, Polska and Northern Lights.
      </p>
      <p>
        <strong>A ticket is worth the shortest path between its two stops</strong>, counted in wagon
        spaces. That is not a simplification — it is exactly what the official maps do. Nordic gets
        46 of 46 tickets right that way, India 58 of 58, Polska 35 of 35. Colour, grey routes,
        tunnels and ferry locomotives change nothing. Those are difficulty, and difficulty is part of
        playing, not part of what a card is worth.
      </p>
      <p>
        <strong>A deck gets a score</strong>, and lower is better. It weighs how the ticket lengths
        are spread, whether long tickets reach the edges of the map while short ones stay nearer the
        middle, how many stops no ticket ever names, how many near-duplicate pairs there are, how
        many routes no ticket needs, and how evenly the traffic falls across the board. Every official
        deck scores clearly better than random decks of the same size on the same map. When the
        editor builds a deck it is searching for a low score, starting from a rough deck and
        swapping tickets some thousands of times. The score is a guide, not a verdict: the official
        decks are more uneven than the editor&apos;s own suggestions, on purpose.
      </p>
      <p>
        <strong>Official maps are tense, but connected.</strong> Every one of them has routes that more
        tickets want than they can carry — 8 to 19 at a full table — mostly on double routes, so the
        squeeze tightens as the table shrinks. Yet almost nothing on them can be cut off: only Europe
        has a route whose loss splits the map, and it is a double route. So Map balance describes
        crowding, dead ends and corners against what the official maps have, and warns only about a
        single-lane route that cuts the map in two. A full deck can be built calm, like the official
        maps, or tense, and a route or a stop can be marked as crowded on purpose.
      </p>
      <figure>
        <img src="/ttr/images/about-balance.png" width={1000} height={378} alt="Map balance comparing the example map with the official maps: crowded routes, traffic on double routes, routes no ticket needs, the busiest stop and the average hub degree" />
        <figcaption>Map balance sets each figure beside what the eight official maps measure.</figcaption>
      </figure>
      <p>
        Every target in that score is an average of the official decks rather than one game&apos;s
        habits. The first version was fitted to the USA map alone, and several official decks then
        scored <em>worse</em> than random ones. That was the clearest sign the targets were wrong.
      </p>
    </section>

    <section>
      <h2>What it will not do</h2>
      <p>
        It does not play the game. Everything it says is read off the shape of the network, not off
        simulated play, so it can tell you that eleven tickets all want the same route while nothing
        else reaches that corner of the map — but it cannot tell you whether that is exciting or
        unfair. That is what the highlighter pens are for.
      </p>
      <p>
        It has no opinion about the art, no country or region tickets yet, and no rules for zones,
        festivals or shared track. Maps built on those ideas priced their tickets well above the
        shortest path, and the editor says so rather than guessing a number.
      </p>
    </section>

    <section>
      <h2>Choices behind it</h2>
      <dl className="about-choices">
        <div>
          <dt>Points are the shortest path, always</dt>
          <dd>Exact on the classic official maps, and the only rule with evidence across many of
            them. A long-ticket bonus and a ferry premium exist as options, both off unless a map
            asks for them.</dd>
        </div>
        <div>
          <dt>Crowding is shown, never priced</dt>
          <dd>Map balance lists the routes more tickets want than they can carry. No official
            designer pays extra for a crowded corridor, so neither does this.</dd>
        </div>
        <div>
          <dt>Ticket lengths are relative to the map</dt>
          <dd>Short, medium and long are shares of the longest journey on your board, not fixed
            wagon counts, so the same mix means the same thing on a small map and a large one.</dd>
        </div>
        <div>
          <dt>Files keep what they do not understand</dt>
          <dd>Every exported file says which schema it follows, and any field written by a newer
            version is carried through untouched. Two people on different versions can pass a map
            back and forth without either of them quietly destroying the other&apos;s work.</dd>
        </div>
      </dl>
      <p className="about-note">
        The full record, with what was rejected and what would change our minds, is in{" "}
        <a href={`${REPO_URL}/blob/main/docs/DECISIONS.md`} target="_blank" rel="noopener noreferrer">the decisions</a>; the file format is
        described in <a href={`${REPO_URL}/blob/main/docs/FILE-FORMAT.md`} target="_blank" rel="noopener noreferrer">the file format</a>.
      </p>
    </section>

    <footer className="about-foot">
      <p>Version {APP_VERSION} · file format {LYING_FILE_VERSION}, or {FILE_VERSION} for a standing board · <Link href="/whats-new">What&apos;s new</Link> · <a href={REPO_URL} target="_blank" rel="noopener noreferrer">Source code</a> (MIT licence)</p>
      <p>
        Ticket to Ride is a game by Alan R. Moon, published by Days of Wonder. This is an unofficial
        tool for designing your own boards, and is not affiliated with them. The reference data is a
        factual transcription of published maps, kept for analysis.
      </p>
      <Link href="/">Back to the editor</Link>
    </footer>
  </main>;
}
