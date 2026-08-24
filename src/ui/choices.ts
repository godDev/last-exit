import type { Input } from '../core/input';
import { t } from '../content/i18n';

export interface ChoiceOption { id: string; text: string; }

/** Modal story decision. Rendering continues, while the coach waits for the player's answer. */
export class Choices {
  private readonly root = document.getElementById('choices')!;
  private options: ChoiceOption[] = [];
  private clicked = -1;
  private selected = 0;

  constructor() {
    this.root.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-choice]');
      if (button) {
        this.selected = Number(button.dataset.choice);
        this.clicked = this.selected;
      }
    });
  }

  show(title: string, options: ChoiceOption[]): void {
    this.options = options;
    this.clicked = -1;
    this.selected = 0;
    this.render(title);
    this.root.classList.remove('hidden');
    this.root.querySelector<HTMLButtonElement>('[data-choice="0"]')?.focus();
  }

  resolve(input: Input): string | null {
    const actions = ['choiceOne', 'choiceTwo', 'choiceThree'] as const;
    const keyboard = actions.findIndex((action) => input.wasTapped(action));
    if (input.wasTapped('choiceNext')) {
      this.selected = (this.selected + 1) % this.options.length;
      this.refreshSelection();
      return null;
    }
    if (input.wasTapped('choicePrevious')) {
      this.selected = (this.selected - 1 + this.options.length) % this.options.length;
      this.refreshSelection();
      return null;
    }
    const index = this.clicked >= 0
      ? this.clicked
      : keyboard >= 0
        ? keyboard
        : input.wasTapped('choiceConfirm')
          ? this.selected
          : -1;
    if (index < 0 || !this.options[index]) return null;
    const id = this.options[index].id;
    this.options = [];
    this.clicked = -1;
    this.root.classList.add('hidden');
    return id;
  }

  get active(): boolean { return this.options.length > 0; }

  private render(title: string): void {
    this.root.innerHTML = `<div class="choice-box" role="dialog" aria-modal="true" aria-labelledby="choice-title"><p id="choice-title">${title}</p>${this.options.map((o, i) => `<button type="button" data-choice="${i}" class="${i === this.selected ? 'selected' : ''}"><b>${i + 1}</b>${o.text}</button>`).join('')}<small>${t('choice.navigate')}</small></div>`;
  }

  private refreshSelection(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((button) => {
      button.classList.toggle('selected', Number(button.dataset.choice) === this.selected);
    });
  }
}
