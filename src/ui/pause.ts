import { t } from '../content/i18n';

export class PauseMenu {
  private readonly root = document.getElementById('pause-menu')!;

  constructor(onResume: () => void, onRestart: () => void, onReturnToMenu: () => void) {
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-pause-resume]')) onResume();
      if (target.closest('[data-pause-restart]')) onRestart();
      if (target.closest('[data-pause-menu]')) onReturnToMenu();
    });
  }

  show(): void {
    this.root.innerHTML = `
      <section class="pause-box" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <p class="pause-kicker">ROUTE 17 / NIGHT SERVICE</p>
        <h2 id="pause-title">${t('pause.title')}</h2>
        <button type="button" data-pause-resume>${t('pause.continue')}</button>
        <button type="button" data-pause-menu>${t('pause.menu')}</button>
        <button type="button" class="danger" data-pause-restart>${t('pause.restart')}</button>
        <small>${t('pause.menuHint')}<br>${t('pause.restartHint')}</small>
      </section>`;
    this.root.classList.remove('hidden');
    this.root.querySelector<HTMLButtonElement>('[data-pause-resume]')?.focus();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.root.textContent = '';
  }
}
