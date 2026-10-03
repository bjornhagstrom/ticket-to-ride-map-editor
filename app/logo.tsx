// The logo: a route, two stops joined by three wagon spaces along a curve. It is what every Ticket to
// Ride map is made of, whatever runs on it — trains, buses or boats. public/favicon.svg is the same
// drawing; tests/regression.cjs checks that the two agree.
const WAGONS: [number, number, number][] = [[17.74, 31.95, -61.1], [25, 23.5, -36.4], [35.22, 19.07, -11.7]];

export function RouteLogo({ className, title = "Map prototypes" }: { className?: string; title?: string }) {
  return <svg className={`route-logo${className ? ` ${className}` : ""}`} viewBox="0 0 64 64" role="img" aria-label={title}>
    <rect width="64" height="64" rx="14" fill="#721c24" />
    {WAGONS.map(([x, y, angle]) => <rect key={x} className="route-logo-wagon" x="-5.4" y="-3.2" width="10.8" height="6.4" rx="1.8" fill="#f7f1e5" transform={`translate(${x} ${y}) rotate(${angle})`} />)}
    <circle className="route-logo-stop" cx="13" cy="47" r="5.6" fill="#721c24" stroke="#f7f1e5" strokeWidth="3.2" />
    <circle className="route-logo-stop" cx="51" cy="19" r="5.6" fill="#721c24" stroke="#f7f1e5" strokeWidth="3.2" />
  </svg>;
}
