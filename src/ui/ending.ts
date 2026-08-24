import type { StoryEnding } from '../core/story';
import { t } from '../content/i18n';

/** A terminal result, not a paused gameplay subtitle. */
export class EndingScreen {
  private readonly root = document.getElementById('ending')!;

  constructor(private readonly onRestart: () => void) {
    this.root.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-restart-shift]')) this.onRestart();
    });
  }

  show(ending: StoryEnding): void {
    const title = t(`ending.${ending}.title`);
    const detail = t(`ending.${ending}.detail`);
    this.root.innerHTML = `<section class="ending-box" role="dialog" aria-modal="true" aria-labelledby="ending-title"><h2 id="ending-title">${title}</h2><p>${detail}</p><button type="button" data-restart-shift>${t('ending.restart')}</button></section>`;
    this.root.classList.remove('hidden');
    this.root.querySelector<HTMLButtonElement>('[data-restart-shift]')?.focus();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.root.textContent = '';
  }

  get visible(): boolean { return !this.root.classList.contains('hidden'); }
}
