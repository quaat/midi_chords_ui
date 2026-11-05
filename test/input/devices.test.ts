import { describe, expect, it } from "vitest";
import { ap470Checklist, createAp470Report, describeDevice, describeDevices, summarizeAp470Report } from "@/input/devices";

describe("describeDevice", () => {
  it("produces a stable label from name and manufacturer", () => {
    expect(describeDevice({ id: "1", name: "Digital Piano", manufacturer: "Casio" })).toBe("Digital Piano (Casio)");
    expect(describeDevice({ id: "1", name: "CASIO USB-MIDI", manufacturer: "Casio" })).toBe("CASIO USB-MIDI");
    expect(describeDevice({ id: "1", name: null, manufacturer: null, type: "input" })).toBe("Unknown MIDI input");
  });

  it("disambiguates duplicate names", () => {
    expect(describeDevices([{ id: "a", name: "Keys" }, { id: "b", name: "Keys" }, { id: "c", name: "Pads" }])).toEqual(["Keys", "Keys #2", "Pads"]);
  });
});

describe("AP-470 checklist", () => {
  it("creates an untested report covering every checklist field", () => {
    const report = createAp470Report();
    expect(report.tested).toBe(false);
    expect(report.latencyEstimateMs).toBeNull();
    expect(report.noteOnOff).toBe("notTested");
    for (const item of ap470Checklist) {
      expect(item.field in report).toBe(true);
    }
    const fields = ap470Checklist.map((item) => item.field);
    for (const required of ["osName", "browser", "firmware", "connectionRoute", "observedDeviceName", "noteOnOff", "velocity", "sustainPedal", "sostenuto", "soft", "localControlNote", "reconnect", "latencyEstimateMs", "notes"]) {
      expect(fields).toContain(required);
    }
    expect(summarizeAp470Report(report)).toContain("not yet tested");
  });

  it("summarises a tested report with open items", () => {
    const report = { ...createAp470Report(), tested: true, osName: "Windows 11", browser: "Chrome 130", noteOnOff: "pass" as const, velocity: "pass" as const, sustainPedal: "pass" as const, sostenuto: "partial" as const, soft: "pass" as const, reconnect: "pass" as const };
    expect(summarizeAp470Report(report)).toBe("Casio Celviano AP-470 tested on Windows 11, Chrome 130: open: sostenuto (partial).");
  });
});
