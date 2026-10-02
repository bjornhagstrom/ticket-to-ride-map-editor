import Link from "next/link";
import { BusFront, ArrowLeft } from "lucide-react";
import { APP_VERSION, FILE_VERSION } from "../map-storage";
import "../about.css";

export const metadata = { title: "About – Ticket to Ride – Map prototypes" };

export default function About() {
  return <main className="about">
    <header className="about-head">
      <span className="brand-mark"><BusFront /></span>
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
        Nothing leaves your browser: the map you are working on is stored locally, and files move by
        export and import.
      </p>
    </section>

    <section>
      <h2>Wagon spaces are real size</h2>
      <p>
        A wagon space is drawn at the size a real 20 × 9 mm train takes up on a 790 mm board, with
        the spacing measured from a hundred real routes. So a route that is six spaces long has room
        for six actual plastic trains when you print at full size. If a route is drawn too short for
        the number of spaces you gave it, the balance report says so, in millimetres.
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
        many routes no ticket needs, and how evenly the traffic falls across the board. The scale is
        set so that the official decks land below 5 and a random deck of the same size lands above
        10. When the editor suggests a deck it is searching for a low score, starting from a rough
        deck and swapping tickets some thousands of times.
      </p>
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
          <dd>The balance view lists the routes more tickets want than they can carry. No official
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
        The full record, with what was rejected and what would change our minds, is in
        <code>docs/DECISIONS.md</code>; the file format is described in <code>docs/FILE-FORMAT.md</code>.
      </p>
    </section>

    <footer className="about-foot">
      <p>Version {APP_VERSION} · file format {FILE_VERSION} · <Link href="/whats-new">What&apos;s new</Link></p>
      <p>
        Ticket to Ride is a game by Alan R. Moon, published by Days of Wonder. This is an unofficial
        tool for designing your own boards, and is not affiliated with them. The reference data is a
        factual transcription of published maps, kept for analysis.
      </p>
      <Link href="/">Back to the editor</Link>
    </footer>
  </main>;
}
