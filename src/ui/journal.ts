import { PASSENGERS, EVIDENCE } from '../content/passengers';
import type { Story } from '../core/story';
import { settings } from '../core/settings';

/** Driver's notebook: deliberately records facts, never identifies the answer for the player. */
export class Journal {
  private readonly root = document.getElementById('journal')!;
  private open = false;

  toggle(story: Story): void {
    this.open = !this.open;
    if (this.open) this.render(story);
    this.root.classList.toggle('hidden', !this.open);
    if (this.open) this.root.querySelector<HTMLButtonElement>('[data-journal-close]')?.focus();
  }

  close(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  get visible(): boolean { return this.open; }

  refresh(story: Story): void {
    if (this.open) this.render(story);
  }

  private render(story: Story): void {
    const ru = settings.lang === 'ru';
    const listed = story.state.passengers
      .map((id) => PASSENGERS.find((profile) => profile.id === id))
      .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));
    const evidence = story.state.evidence.map((id) => EVIDENCE[id]).filter(Boolean);
    this.root.innerHTML = `
      <section class="journal-paper">
        <button type="button" class="journal-close" data-journal-close aria-label="Close journal">J</button>
        <h2>${ru ? 'ЖУРНАЛ ВОДИТЕЛЯ' : 'DRIVER’S JOURNAL'}</h2>
        <p class="journal-note">${ru ? 'Факты не являются ответом. Сопоставь их сам.' : 'Facts are not an answer. Make the connection yourself.'}</p>
        <h3>${ru ? 'ПАССАЖИРЫ' : 'PASSENGERS'}</h3>
        <ul>${listed.map((p) => `<li><b>${p.name}</b> — ${ru ? p.roleRu : p.role}</li>`).join('') || `<li>${ru ? 'Нет записей.' : 'No entries.'}</li>`}</ul>
        <h3>${ru ? 'УЛИКИ' : 'EVIDENCE'}</h3>
        <ul>${evidence.map((item) => `<li><b>${ru ? item.titleRu : item.title}</b><span>${ru ? item.detailRu : item.detail}</span></li>`).join('') || `<li>${ru ? 'Пока ничего.' : 'Nothing yet.'}</li>`}</ul>
      </section>`;
    this.root.querySelector<HTMLButtonElement>('[data-journal-close]')?.addEventListener('click', () => this.close());
  }
}
