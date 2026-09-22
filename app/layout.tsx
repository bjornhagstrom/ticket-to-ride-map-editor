import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ticket to Ride – Map editor",
  description: "Build and test route networks for custom maps.",
  icons: {
    icon: "/ttr/favicon.svg",
    shortcut: "/ttr/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
