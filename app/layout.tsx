import type { Metadata } from "next";
import "./globals.css";
import "./styles/practice.css";
import "./styles/learn.css";

export const metadata: Metadata = {
  title: "Piano Learning Studio",
  description: "Explore, practise, and create chords and voicings around one interactive piano, with falling notes, step practice, and MIDI keyboard support."
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
