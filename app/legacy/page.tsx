import type { Metadata } from "next";
import { ChordStudio } from "@/ui/components/ChordStudio";

export const metadata: Metadata = {
  title: "Chord to MIDI Studio (legacy) · Piano Learning Studio",
  description: "The previous plain-text chord chart to MIDI studio, kept available during the migration."
};

export default function LegacyPage(): JSX.Element {
  return <ChordStudio />;
}
