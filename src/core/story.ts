/** Persistent, content-facing state for one Route 17 shift. */

export type StoryAct = 'departure' | 'mile86' | 'gas' | 'patrol' | 'motel' | 'finale';
export type StoryPresence = 'both' | 'cabin' | 'mirror' | 'nowhere';
export type StoryStopId = 'mile86' | 'closed-gas' | 'millers-gas' | 'highway-patrol' | 'sunset-motel' | 'final-stop';
export type StoryChoiceScene = 'mile86' | 'stranded-man' | 'patrol' | 'finale';
export type StoryEnding = 'arrival' | 'route-continues' | 'no-final-stop';

/**
 * A save restores the player to a safe, authored state rather than to an arbitrary
 * frame. Exterior movement intentionally resumes in the parked coach; discovered facts
 * are already persisted, so no scene progress is lost.
 */
export type ShiftCheckpoint =
  | { kind: 'driving' }
  | { kind: 'stop'; stopId: StoryStopId }
  | { kind: 'choice'; stopId: StoryStopId; scene: StoryChoiceScene }
  | { kind: 'ending'; ending: StoryEnding };

/** The visual part of a passenger is story state too. A save must not turn a ghost back
 * into an ordinary fare just because the page was reloaded. */
export interface SavedAppearance {
  presence: StoryPresence;
  sway: number;
  eyeshine: number;
  /** Stable seed for face, build, hair, clothing details and accessories. */
  lookSeed?: number;
}

export interface StoryState {
  version: 3;
  act: StoryAct;
  flags: string[];
  choices: Record<string, string>;
  evidence: string[];
  passengers: string[];
  appearances: Record<string, SavedAppearance>;
  /** One-shot cues that have already happened. Kept with the save, not with a page load. */
  firedEvents: string[];
  checkpoint: ShiftCheckpoint;
}

export interface SaveData {
  version: 3;
  story: StoryState;
  mile: number;
  minutes: number;
  /** Persistent mechanical/cosmetic damage accumulated by the player's coach. */
  busDamage?: number;
  /** Frontal pole impacts create their own non-radial windscreen crack layer. */
  busPoleCracks?: number;
}

const SAVE_KEY = 'last-exit.route17.autosave.v1';

export function newStory(): StoryState {
  return {
    version: 3,
    act: 'departure',
    flags: [],
    choices: {},
    evidence: [],
    passengers: ['marian-cole', 'ray-hollis', 'helen-pike'],
    appearances: {},
    firedEvents: [],
    checkpoint: { kind: 'driving' },
  };
}

/** Small state owner: content can ask questions without reaching into localStorage. */
export class Story {
  state: StoryState;

  constructor(state: StoryState = newStory()) {
    this.state = state;
  }

  has(flag: string): boolean { return this.state.flags.includes(flag); }

  flag(flag: string): void {
    if (!this.has(flag)) this.state.flags.push(flag);
  }

  choose(id: string, value: string): void {
    this.state.choices[id] = value;
    this.flag(`choice:${id}`);
  }

  evidence(id: string): void {
    if (!this.state.evidence.includes(id)) this.state.evidence.push(id);
  }

  setAct(act: StoryAct): void { this.state.act = act; }

  checkpoint(checkpoint: ShiftCheckpoint): void { this.state.checkpoint = checkpoint; }

  setAppearance(id: string, appearance: SavedAppearance): void {
    this.state.appearances[id] = appearance;
  }

  appearance(id: string): SavedAppearance | undefined {
    return this.state.appearances[id];
  }

  markEvent(id: string): void {
    if (!this.state.firedEvents.includes(id)) this.state.firedEvents.push(id);
  }

  /** Repair a save/session from an older build that fired an arrival without parking. */
  recoverInterruptedScene(): boolean {
    const recovered = recoverInterruptedScene(this.state.checkpoint, this.state.flags, this.state.firedEvents);
    if (recovered === this.state.checkpoint) return false;
    this.state.checkpoint = recovered;
    return true;
  }

  autosave(mile: number, minutes: number, busDamage = 0, busPoleCracks = 0): void {
    const data: SaveData = {
      version: 3,
      story: structuredClone(this.state),
      mile: Math.max(0, mile),
      minutes,
      busDamage: Math.max(0, Math.min(1, Number.isFinite(busDamage) ? busDamage : 0)),
      busPoleCracks: Math.max(0, Math.min(8, Math.floor(Number.isFinite(busPoleCracks) ? busPoleCracks : 0))),
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage is optional */ }
  }

  static load(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as Partial<SaveData> & { version?: number; story?: Partial<StoryState> };
      if (!data.story || !Number.isFinite(data.mile) || !Number.isFinite(data.minutes)) {
        return null;
      }
      const mile = data.mile as number;
      const minutes = data.minutes as number;
      // Autosaves from the prototype did not contain event or appearance state. They are
      // still useful, so migrate them rather than dropping a player's shift.
      const flags = Array.isArray(data.story.flags) ? data.story.flags : [];
      const fallbackCheckpoint = endingFromFlags(flags) ?? { kind: 'driving' } as const;
      const savedCheckpoint = validCheckpoint(data.story.checkpoint) ? data.story.checkpoint : fallbackCheckpoint;
      const migrated: StoryState = {
        ...newStory(),
        ...data.story,
        version: 3,
        flags,
        choices: data.story.choices ?? {},
        evidence: Array.isArray(data.story.evidence) ? data.story.evidence : [],
        passengers: Array.isArray(data.story.passengers) ? data.story.passengers : newStory().passengers,
        appearances: data.story.appearances ?? {},
        firedEvents: Array.isArray(data.story.firedEvents) ? data.story.firedEvents : [],
        checkpoint: recoverInterruptedScene(savedCheckpoint, flags, Array.isArray(data.story.firedEvents) ? data.story.firedEvents : []),
      };
      const busDamage = Math.max(0, Math.min(1, Number.isFinite(data.busDamage) ? data.busDamage as number : 0));
      const busPoleCracks = Math.max(0, Math.min(8,
        Math.floor(Number.isFinite(data.busPoleCracks) ? data.busPoleCracks as number : 0)));
      return { version: 3, story: migrated, mile: Math.max(0, mile), minutes, busDamage, busPoleCracks };
    } catch { return null; }
  }

  static clearSave(): void {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* storage is optional */ }
  }
}

function validCheckpoint(value: unknown): value is ShiftCheckpoint {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false;
  const checkpoint = value as Partial<ShiftCheckpoint>;
  if (checkpoint.kind === 'driving') return true;
  if (checkpoint.kind === 'ending') {
    return checkpoint.ending === 'arrival' || checkpoint.ending === 'route-continues' || checkpoint.ending === 'no-final-stop';
  }
  if (checkpoint.kind === 'stop') return isStopId(checkpoint.stopId);
  return checkpoint.kind === 'choice' && isStopId(checkpoint.stopId) && isChoiceScene(checkpoint.scene);
}

function isStopId(value: unknown): value is StoryStopId {
  return value === 'mile86' || value === 'closed-gas' || value === 'millers-gas'
    || value === 'highway-patrol' || value === 'sunset-motel' || value === 'final-stop';
}

function isChoiceScene(value: unknown): value is StoryChoiceScene {
  return value === 'mile86' || value === 'stranded-man' || value === 'patrol' || value === 'finale';
}

function endingFromFlags(flags: string[]): ShiftCheckpoint | null {
  if (flags.includes('ending:arrival')) return { kind: 'ending', ending: 'arrival' };
  if (flags.includes('ending:route-continues')) return { kind: 'ending', ending: 'route-continues' };
  if (flags.includes('ending:no-final-stop')) return { kind: 'ending', ending: 'no-final-stop' };
  return null;
}

/**
 * Early story saves recorded fired event IDs but not the forced-stop state. Do not let a
 * one-shot arrival from those builds silently skip a mandatory scene after migration.
 */
function recoverInterruptedScene(
  checkpoint: ShiftCheckpoint,
  flags: string[],
  firedEvents: string[],
): ShiftCheckpoint {
  if (checkpoint.kind !== 'driving') return checkpoint;
  const fired = new Set(firedEvents);
  if (fired.has('mile86.arrive') && !flags.includes('choice:mile86')) {
    return { kind: 'stop', stopId: 'mile86' };
  }
  if (fired.has('roadside.arrive') && !flags.includes('choice:stranded-man')) {
    return { kind: 'stop', stopId: 'closed-gas' };
  }
  if (fired.has('millers.arrive') && !flags.includes('miller.returned')) {
    return { kind: 'stop', stopId: 'millers-gas' };
  }
  if (fired.has('patrol.stop') && !flags.includes('choice:patrol')) {
    return { kind: 'stop', stopId: 'highway-patrol' };
  }
  if (fired.has('motel.arrive') && !flags.includes('motel.roster-revealed')) {
    return { kind: 'stop', stopId: 'sunset-motel' };
  }
  if (fired.has('finale.arrive') && !flags.includes('choice:finale')) {
    return { kind: 'stop', stopId: 'final-stop' };
  }
  return checkpoint;
}
