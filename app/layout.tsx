import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chord to MIDI Studio",
  description: "Convert plain-text chord charts into MIDI with synchronized playback and visualization."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
