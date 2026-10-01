import Link from "next/link";
import { BusFront, ArrowLeft } from "lucide-react";
import { RELEASES } from "../version";
import "../about.css";

export const metadata = { title: "What's new – Ticket to Ride – Map prototypes" };

export default function WhatsNew() {
  return <main className="about whats-new">
    <header className="about-head">
      <span className="brand-mark"><BusFront /></span>
      <div>
        <p>Ticket to Ride · Map prototypes</p>
        <h1>What&apos;s new</h1>
      </div>
      <Link className="about-back" href="/"><ArrowLeft />Back to the editor</Link>
    </header>

    {RELEASES.map((release) => <article className="release" key={release.version}>
      <h2>Version {release.version} <time dateTime={release.date}>{release.date}</time></h2>
      <p className="release-title">{release.title}</p>
      <ul>{release.changes.map((change) => <li key={change}>{change}</li>)}</ul>
    </article>)}

    <footer className="about-foot">
      <p>Your maps stay in your browser when a new version arrives; export a copy now and then to be safe. <Link href="/about">About this tool</Link></p>
      <Link href="/">Back to the editor</Link>
    </footer>
  </main>;
}
