/**
 * Device description helpers and the AP-470 reference-device acceptance checklist
 * (plan §4 "AP-470 reference-device acceptance", E09 rev. 2, E21).
 *
 * Software fixtures alone never establish physical device compatibility: a report stays
 * `tested: false` until someone runs the checklist on the real instrument.
 */

export interface DescribablePort {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  type?: string;
}

/**
 * Stable, human-readable label for a MIDI port. Deliberately excludes volatile fields
 * (state/connection) so the label does not change across hot-plug events.
 */
export function describeDevice(port: DescribablePort): string {
  const name = port.name !== undefined && port.name !== null ? port.name.trim() : "";
  const manufacturer = port.manufacturer !== undefined && port.manufacturer !== null ? port.manufacturer.trim() : "";
  const base = name !== "" ? name : `Unknown MIDI ${port.type === "output" ? "output" : port.type === "input" ? "input" : "device"}`;
  if (manufacturer !== "" && !base.toLowerCase().includes(manufacturer.toLowerCase())) {
    return `${base} (${manufacturer})`;
  }
  return base;
}

/** Labels for a list of ports, disambiguating duplicates with " #2", " #3" in list order. */
export function describeDevices(ports: DescribablePort[]): string[] {
  const counts = new Map<string, number>();
  return ports.map((port) => {
    const label = describeDevice(port);
    const seen = (counts.get(label) ?? 0) + 1;
    counts.set(label, seen);
    return seen > 1 ? `${label} #${seen}` : label;
  });
}

export type CheckOutcome = "notTested" | "pass" | "partial" | "fail" | "notApplicable";

export interface Ap470Report {
  device: "Casio Celviano AP-470";
  osName: string;
  browser: string;
  /** Firmware version if the instrument exposes it; null when unknown. */
  firmware: string | null;
  /** e.g. "USB Type-B → USB-A, direct (no hub)". */
  connectionRoute: string;
  /** Port name exactly as Web MIDI reports it. */
  observedDeviceName: string;
  noteOnOff: CheckOutcome;
  velocity: CheckOutcome;
  sustainPedal: CheckOutcome;
  sostenuto: CheckOutcome;
  soft: CheckOutcome;
  /** What was observed about Local Control (piano's own sound vs app monitoring/echo). */
  localControlNote: string;
  reconnect: CheckOutcome;
  /** Estimate only: event receipt is not key motion. null until measured. */
  latencyEstimateMs: number | null;
  tested: boolean;
  testedAt: string | null;
  notes: string;
}

export type Ap470Field = Exclude<keyof Ap470Report, "device" | "tested" | "testedAt">;

export interface Ap470ChecklistItem {
  field: Ap470Field;
  label: string;
  instruction: string;
}

export const ap470Checklist: readonly Ap470ChecklistItem[] = [
  { field: "osName", label: "Operating system", instruction: "Record OS name and version (e.g. Windows 11 23H2, macOS 15.1)." },
  { field: "browser", label: "Browser", instruction: "Record browser name and full version; Web MIDI requires a secure context." },
  { field: "firmware", label: "Firmware", instruction: "Record the instrument firmware version if available; leave empty if unknown." },
  { field: "connectionRoute", label: "Connection route", instruction: "USB Type-B cable directly to the computer, or describe any hub/adapter used." },
  { field: "observedDeviceName", label: "Observed device name", instruction: "Copy the input port name exactly as shown in the device picker." },
  { field: "noteOnOff", label: "Note on/off", instruction: "Play single keys across the range; every press and release appears once, with no stuck notes." },
  { field: "velocity", label: "Velocity", instruction: "Play soft and hard; reported velocities vary over a plausible 1..127 range." },
  { field: "sustainPedal", label: "Sustain pedal (CC64)", instruction: "Hold notes, press and release the damper pedal; sustained notes stop on pedal up." },
  { field: "sostenuto", label: "Sostenuto (CC66)", instruction: "Hold a chord, press sostenuto, release the chord, play other notes; only the chord is held." },
  { field: "soft", label: "Soft pedal (CC67)", instruction: "Press and release the soft pedal; a down/up transition is observed." },
  {
    field: "localControlNote",
    label: "Local Control / monitoring",
    instruction: "With monitoring OFF the piano's own sound plays and the app only observes; confirm no doubled notes. Note Local Control setting."
  },
  { field: "reconnect", label: "Reconnect", instruction: "Unplug and re-plug USB mid-session; held notes clear and the same device is re-selected automatically." },
  { field: "latencyEstimateMs", label: "Latency estimate (ms)", instruction: "Run calibration; record the estimate and note that it is not a measurement of key motion." },
  { field: "notes", label: "Notes", instruction: "Anything unexpected, workarounds, or follow-up issues." }
];

/** A blank report. Support remains unverified until the physical test marks it tested. */
export function createAp470Report(): Ap470Report {
  return {
    device: "Casio Celviano AP-470",
    osName: "",
    browser: "",
    firmware: null,
    connectionRoute: "",
    observedDeviceName: "",
    noteOnOff: "notTested",
    velocity: "notTested",
    sustainPedal: "notTested",
    sostenuto: "notTested",
    soft: "notTested",
    localControlNote: "",
    reconnect: "notTested",
    latencyEstimateMs: null,
    tested: false,
    testedAt: null,
    notes: ""
  };
}

/** One-line status for release notes / E21 evidence. */
export function summarizeAp470Report(report: Ap470Report): string {
  if (!report.tested) {
    return "Casio Celviano AP-470: not yet tested on hardware.";
  }
  const outcomes: [string, CheckOutcome][] = [
    ["note on/off", report.noteOnOff],
    ["velocity", report.velocity],
    ["sustain", report.sustainPedal],
    ["sostenuto", report.sostenuto],
    ["soft", report.soft],
    ["reconnect", report.reconnect]
  ];
  const failing = outcomes.filter(([, outcome]) => outcome === "fail" || outcome === "partial" || outcome === "notTested");
  const where = [report.osName, report.browser].filter((part) => part !== "").join(", ");
  const status = failing.length === 0 ? "all checks passed" : `open: ${failing.map(([label, outcome]) => `${label} (${outcome})`).join(", ")}`;
  return `Casio Celviano AP-470 tested${where !== "" ? ` on ${where}` : ""}${report.testedAt ? ` at ${report.testedAt}` : ""}: ${status}.`;
}
