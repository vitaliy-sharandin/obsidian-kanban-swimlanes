import { Menu } from 'obsidian';
import { c } from './helpers';

interface ColorPickerOptions {
  win: Window;
  x: number;
  y: number;
  color?: string;
  defaultColor: string;
  onChange: (color: string) => void;
  onReset?: () => void;
}

export function openColorPickerPopover({
  win,
  x,
  y,
  color,
  defaultColor,
  onChange,
  onReset,
}: ColorPickerOptions) {
  const popover = win.document.body.createDiv({ cls: c('color-popover') });
  const initial = color || defaultColor;

  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;

  const input = popover.createEl('input', { type: 'color', cls: c('color-popover-swatch') });
  input.value = /^#[0-9a-fA-F]{6}$/.test(initial) ? initial : defaultColor;

  const text = popover.createEl('input', { type: 'text', cls: c('color-popover-input') });
  text.value = initial;

  const actions = popover.createDiv({ cls: c('color-popover-actions') });
  const apply = actions.createEl('button', { text: 'Apply' });
  const reset = actions.createEl('button', { text: 'Reset' });

  const close = () => {
    popover.remove();
    win.document.removeEventListener('mousedown', onDocumentMouseDown, true);
    win.document.removeEventListener('keydown', onKeyDown, true);
  };

  const onDocumentMouseDown = (event: MouseEvent) => {
    if (!popover.contains(event.target as Node)) {
      close();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close();
    }
  };

  input.addEventListener('input', () => {
    text.value = input.value;
  });

  text.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(text.value)) {
      input.value = text.value;
    }
  });

  apply.addEventListener('click', () => {
    onChange(text.value.trim());
    close();
  });

  reset.addEventListener('click', () => {
    onReset?.();
    close();
  });

  win.setTimeout(() => {
    const rect = popover.getBoundingClientRect();
    if (rect.right > win.innerWidth) {
      popover.style.left = `${Math.max(8, x - rect.width)}px`;
    }
    if (rect.bottom > win.innerHeight) {
      popover.style.top = `${Math.max(8, y - rect.height)}px`;
    }
    win.document.addEventListener('mousedown', onDocumentMouseDown, true);
    win.document.addEventListener('keydown', onKeyDown, true);
  });
}

export function addColorMenuItem(
  menu: Menu,
  title: string,
  color: string | undefined,
  defaultColor: string,
  onChange: (color: string) => void,
  onReset?: () => void
) {
  menu.addItem((item) => {
    item
      .setIcon('lucide-palette')
      .setTitle(title)
      .onClick((event) => {
        const isMouseEvent = 'clientX' in event;
        const win = event.view;
        openColorPickerPopover({
          win,
          x: isMouseEvent ? event.clientX : win.innerWidth / 2,
          y: isMouseEvent ? event.clientY : win.innerHeight / 2,
          color,
          defaultColor,
          onChange,
          onReset,
        });
      });
  });
}
