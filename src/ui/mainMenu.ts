import { MENU_CHECKPOINTS, type MenuCheckpointId } from '../core/checkpoints';
import type { SaveData } from '../core/story';
import { settings } from '../core/settings';
import { t } from '../content/i18n';

export interface MainMenuActions {
  continueShift(): void;
  newShift(): void;
  selectCheckpoint(id: MenuCheckpointId): void;
  setLanguage(lang: 'en' | 'ru'): void;
  showMenuMusic(): void;
  hideMenuMusic(): void;
  retryMenuMusic(): void;
}

/** Full-screen shell shown before a shift and after returning from the pause menu. */
export class MainMenu {
  private readonly root = document.getElementById('boot')!;
  private save: SaveData | null = null;
  private checkpointsOpen = false;

  constructor(private readonly actions: MainMenuActions) {
    this.root.addEventListener('click', (event) => this.click(event));
  }

  show(save: SaveData | null): void {
    this.save = save;
    this.checkpointsOpen = false;
    this.render();
    this.root.classList.remove('gone');
    this.actions.showMenuMusic();
    this.root.querySelector<HTMLButtonElement>('[data-menu-primary]')?.focus();
  }

  hide(): void {
    this.root.classList.add('gone');
    this.actions.hideMenuMusic();
  }

  refresh(save = this.save): void {
    this.save = save;
    this.render();
  }

  private click(event: Event): void {
    // The initial show happens before a browser user gesture. Retrying from the menu click
    // is what lets the atmospheric track begin reliably without an extra "enable audio" UI.
    this.actions.retryMenuMusic();
    const target = event.target as HTMLElement;
    const checkpoint = target.closest<HTMLButtonElement>('[data-menu-checkpoint]');
    if (checkpoint) {
      this.actions.selectCheckpoint(checkpoint.dataset.menuCheckpoint as MenuCheckpointId);
      return;
    }
    const language = target.closest<HTMLButtonElement>('[data-menu-lang]');
    if (language) {
      this.actions.setLanguage(language.dataset.menuLang === 'ru' ? 'ru' : 'en');
      return;
    }
    const action = target.closest<HTMLButtonElement>('[data-menu-action]')?.dataset.menuAction;
    if (action === 'continue' && this.save) this.actions.continueShift();
    else if (action === 'new') this.actions.newShift();
    else if (action === 'checkpoints') {
      this.checkpointsOpen = !this.checkpointsOpen;
      this.render();
    }
  }

  private render(): void {
    const save = this.save;
    const resume = save
      ? `${t('menu.resumeAt')} ${formatClock(save.minutes)} · ${t('menu.mile')} ${formatMile(save.mile)}`
      : t('menu.noSave');
    const checkpointList = MENU_CHECKPOINTS.map((entry) => `
      <button type="button" class="checkpoint-button" data-menu-checkpoint="${entry.id}">
        <span>${t(entry.titleKey)}</span><small>${t(entry.detailKey)}</small>
      </button>`).join('');
    this.root.innerHTML = `
      <main class="main-menu" aria-label="${t('menu.aria')}">
        <div class="menu-panel">
          <p class="menu-kicker">WESTERN TRAILS / ROUTE 17 / OCTOBER 1991</p>
          <h1>LAST<span>EXIT</span></h1>
          <p class="menu-brief">${t('menu.brief')}</p>
          <div class="menu-actions">
            ${save ? `<button type="button" class="menu-button primary" data-menu-action="continue" data-menu-primary>${t('menu.continue')}<small>${resume}</small></button>` : ''}
            <button type="button" class="menu-button ${save ? '' : 'primary'}" data-menu-action="new" ${save ? '' : 'data-menu-primary'}>${t('menu.newShift')}<small>${t('menu.newShiftDetail')}</small></button>
            <button type="button" class="menu-button" data-menu-action="checkpoints" aria-expanded="${this.checkpointsOpen}">${t('menu.checkpoints')}<small>${t('menu.checkpointsDetail')}</small></button>
          </div>
          <section class="checkpoint-drawer ${this.checkpointsOpen ? '' : 'hidden'}" aria-label="${t('menu.checkpointHeading')}">
            <p>${t('menu.checkpointHeading')}</p>${checkpointList}
          </section>
          <p class="menu-save">${resume}</p>
          <div class="menu-language" aria-label="${t('menu.language')}">
            <button type="button" data-menu-lang="en" class="${settings.lang === 'en' ? 'active' : ''}">EN</button>
            <button type="button" data-menu-lang="ru" class="${settings.lang === 'ru' ? 'active' : ''}">RU</button>
          </div>
        </div>
        <aside class="menu-atmosphere" aria-label="${t('menu.atmosphereLabel')}">
          <span>${t('menu.atmosphereLabel')}</span>
          <p>${t('menu.atmosphere')}</p>
        </aside>
        <p class="menu-controls">${t('menu.controls')}</p>
      </main>`;
  }
}

function formatClock(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatMile(mile: number): string {
  return (Math.round(mile * 10) / 10).toFixed(mile % 1 === 0 ? 0 : 1);
}
