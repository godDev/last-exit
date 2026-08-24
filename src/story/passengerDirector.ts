import type { Presence, Roster } from '../bus/passengers';
import { INITIAL_PASSENGERS, passenger } from '../content/passengers';
import type { Story } from '../core/story';

export interface Appearance {
  presence: Presence;
  sway?: number;
  eyeshine?: number;
}

/** Content-level passenger controller; individual acts never touch three.js passenger meshes. */
export class PassengerDirector {
  constructor(private readonly roster: Roster, private readonly story: Story) {}

  restore(): void {
    const wanted = this.story.state.passengers.every((id) => passenger(id))
      ? this.story.state.passengers
      : INITIAL_PASSENGERS;
    this.story.state.passengers = [];
    for (const id of wanted) {
      this.board(id);
      const saved = this.story.appearance(id);
      if (saved) this.setAppearance(id, saved);
    }
  }

  board(id: string): boolean {
    const profile = passenger(id);
    if (!profile) return false;
    if (!this.roster.find(id)) this.roster.board(profile);
    if (!this.story.state.passengers.includes(id)) this.story.state.passengers.push(id);
    return true;
  }

  setAppearance(id: string, appearance: Appearance): void {
    const figure = this.roster.find(id);
    if (!figure) return;
    const saved = {
      presence: appearance.presence,
      sway: appearance.sway ?? 1,
      eyeshine: appearance.eyeshine ?? 0,
    };
    figure.setPresence(saved.presence);
    figure.sway = saved.sway;
    figure.eyeshine = saved.eyeshine;
    this.story.setAppearance(id, saved);
  }

  /** A named, repeatable story beat: a passenger is present only in the mirror. */
  mirrorOnly(id: string, eyeshine = 0): void {
    this.setAppearance(id, { presence: 'mirror', sway: 0, eyeshine });
  }
}
