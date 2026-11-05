/** Learner input: normalisation, held state, MIDI devices, fallbacks, and replay (plan E09). */

export {
  CC_ALL_NOTES_OFF,
  CC_ALL_SOUND_OFF,
  CC_SOFT,
  CC_SOSTENUTO,
  CC_SUSTAIN,
  PEDAL_DOWN_THRESHOLD,
  isPedalDown,
  isRealtimeMessage,
  parseMidiMessage
} from "@/input/normalize";
export type { MidiBytes, MidiPortMeta } from "@/input/normalize";

export { HeldStateTracker, sourceKeyOf } from "@/input/heldState";
export type {
  AttackChange,
  HeldChange,
  HeldChangeListener,
  PedalChange,
  PedalKind,
  ReleaseChange,
  ResetChange,
  ResetReason
} from "@/input/heldState";

export { MidiInputManager } from "@/input/midiInput";
export type {
  AccessChangedListener,
  DevicesChangedListener,
  InputEventListener,
  MidiAccessInfo,
  MidiAccessReason,
  MidiAccessState,
  MidiDevicesSnapshot,
  MidiInputManagerOptions,
  MidiNavigatorLike,
  MidiPortInfo,
  RawMidiLogEntry
} from "@/input/midiInput";

export {
  COMPUTER_KEY_OFFSETS,
  ComputerKeyboardInput,
  OCTAVE_DOWN_CODE,
  OCTAVE_UP_CODE,
  SUSTAIN_CODE
} from "@/input/computerKeyboard";
export type { ComputerKeyboardListener, ComputerKeyboardOptions, KeyEventTarget, KeyLike } from "@/input/computerKeyboard";

export { TouchInput } from "@/input/touch";
export type { TouchInputListener, TouchInputOptions } from "@/input/touch";

export {
  INPUT_LOG_KIND,
  INPUT_LOG_VERSION,
  ReplayInput,
  createInputLog,
  defaultReplayClock,
  parseInputLog,
  rawToInputEvents,
  serializeInputLog
} from "@/input/replay";
export type { InputLogFile, InputLogInput, ParseInputLogResult, ReplayClock, ReplayListener, ReplayOptions } from "@/input/replay";

export { ap470Checklist, createAp470Report, describeDevice, describeDevices, summarizeAp470Report } from "@/input/devices";
export type { Ap470ChecklistItem, Ap470Field, Ap470Report, CheckOutcome, DescribablePort } from "@/input/devices";

export { RingBuffer } from "@/input/ringBuffer";
