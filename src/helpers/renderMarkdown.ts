import { HoverPopover, Keymap, Menu } from 'obsidian';
import { KanbanView } from 'src/KanbanView';

const noBreakSpace = /\u00A0/g;
const hoverPopoverGap = 10;
const hoverPopoverViewportPadding = 10;

type PositionableHoverPopover = HoverPopover & {
  position?: () => void;
  targetEl?: HTMLElement | null;
};

function positionHoverPopoverNearTarget(popover: PositionableHoverPopover, targetEl: HTMLElement) {
  const hoverEl = popover.hoverEl;
  const targetDocument = targetEl.ownerDocument;

  if (!hoverEl.isConnected || hoverEl.ownerDocument !== targetDocument) return;

  const win = targetDocument.defaultView;
  if (!win) return;

  const targetRect = targetEl.getBoundingClientRect();
  const hoverRect = hoverEl.getBoundingClientRect();
  const availableAbove = targetRect.top - hoverPopoverGap - hoverPopoverViewportPadding;
  const availableBelow =
    win.innerHeight - targetRect.bottom - hoverPopoverGap - hoverPopoverViewportPadding;

  let viewportTop: number;
  if (availableBelow >= hoverRect.height) {
    viewportTop = targetRect.bottom + hoverPopoverGap;
  } else if (availableAbove >= hoverRect.height) {
    viewportTop = targetRect.top - hoverPopoverGap - hoverRect.height;
  } else if (availableBelow >= availableAbove) {
    viewportTop = targetRect.bottom + hoverPopoverGap;
  } else {
    viewportTop = Math.max(
      hoverPopoverViewportPadding,
      targetRect.top - hoverPopoverGap - hoverRect.height
    );
  }

  const offsetParent = hoverEl.offsetParent as HTMLElement | null;
  const offsetParentRect = offsetParent?.getBoundingClientRect();
  const offsetParentTop = offsetParentRect?.top ?? 0;
  const offsetParentScrollTop = offsetParent?.scrollTop ?? 0;

  hoverEl.style.top = `${viewportTop - offsetParentTop + offsetParentScrollTop}px`;
  hoverEl.style.bottom = '';
}

function keepHoverPopoverNearTarget(view: KanbanView, targetEl: HTMLElement) {
  const win = targetEl.ownerDocument.defaultView;
  if (!win) return;

  const startedAt = win.performance.now();
  const findPopover = () => {
    if (!targetEl.isConnected || !targetEl.matches(':hover')) return;

    const popover = view.hoverPopover as PositionableHoverPopover | null;
    if (!popover || (popover.targetEl && popover.targetEl !== targetEl)) {
      if (win.performance.now() - startedAt < 1000) {
        win.setTimeout(findPopover, 50);
      }
      return;
    }

    if (popover.hoverEl.dataset.kanbanSwimlanesPositioned === 'true') return;

    popover.hoverEl.dataset.kanbanSwimlanesPositioned = 'true';
    if (typeof popover.position === 'function') {
      const position = popover.position.bind(popover);
      popover.position = () => {
        position();
        positionHoverPopoverNearTarget(popover, targetEl);
      };
    }
    positionHoverPopoverNearTarget(popover, targetEl);
  };

  findPopover();
}

interface NormalizedPath {
  root: string;
  subpath: string;
  alias: string;
}

export function getNormalizedPath(path: string): NormalizedPath {
  const stripped = path.replace(noBreakSpace, ' ').normalize('NFC');

  // split on first occurance of '|'
  // "root#subpath##subsubpath|alias with |# chars"
  //             0            ^        1
  const splitOnAlias = stripped.split(/\|(.*)/);

  // split on first occurance of '#' (in substring)
  // "root#subpath##subsubpath"
  //   0  ^        1
  const splitOnHash = splitOnAlias[0].split(/#(.*)/);

  return {
    root: splitOnHash[0],
    subpath: splitOnHash[1] ? '#' + splitOnHash[1] : '',
    alias: splitOnAlias[1] || '',
  };
}

export function applyCheckboxIndexes(dom: HTMLElement) {
  const checkboxes = dom.querySelectorAll('.task-list-item-checkbox');

  checkboxes.forEach((el, i) => {
    (el as HTMLElement).dataset.checkboxIndex = i.toString();
  });
}

export function bindMarkdownEvents(view: KanbanView) {
  const { contentEl, app } = view;

  const parseLink = (el: HTMLElement) => {
    const href = el.getAttr('data-href') || el.getAttr('href');
    if (!href) return null;

    return {
      href,
      displayText: el.getText().trim(),
    };
  };

  const onLinkClick = (evt: MouseEvent, targetEl: HTMLElement) => {
    if (evt.button !== 0 && evt.button !== 1) return;

    const link = parseLink(targetEl);
    if (!link) return;

    evt.preventDefault();
    app.workspace.openLinkText(link.href, view.file.path, Keymap.isModEvent(evt));
  };

  contentEl.on('click', 'a.internal-link', onLinkClick);
  contentEl.on('auxclick', 'a.internal-link', onLinkClick);
  contentEl.on('dragstart', 'a.internal-link', (evt: DragEvent) => {
    evt.preventDefault();
  });
  contentEl.on('contextmenu', 'a.internal-link', (evt: PointerEvent, targetEl: HTMLElement) => {
    const link = parseLink(targetEl);
    if (!link) return;

    const menu = new Menu();
    (menu as any).addSections(['title', 'open', 'action', 'view', 'info', '', 'danger']);
    (app.workspace as any).handleLinkContextMenu(menu, link.href, view.file.path);
    menu.showAtMouseEvent(evt);
  });
  contentEl.on('mouseover', 'a.internal-link', (evt: MouseEvent, targetEl: HTMLElement) => {
    const link = parseLink(targetEl);
    if (!link) return;
    app.workspace.trigger('hover-link', {
      event: evt,
      source: 'preview',
      hoverParent: view,
      targetEl,
      linktext: link.href,
      sourcePath: view.file.path,
    });
    keepHoverPopoverNearTarget(view, targetEl);
  });
  contentEl.on('click', 'a.external-link', (evt: MouseEvent, targetEl: HTMLElement) => {
    const link = parseLink(targetEl);
    if (!link) return;

    evt.preventDefault();

    if (!link.href || link.href.contains(' ')) return;
    try {
      new URL(link.href);
    } catch (e) {
      return;
    }

    const paneType = Keymap.isModEvent(evt);
    const clickTarget = typeof paneType === 'boolean' ? '' : paneType;
    window.open(link.href, clickTarget);
  });
  contentEl.on('contextmenu', 'a.external-link', (evt: PointerEvent, targetEl: HTMLElement) => {
    const link = parseLink(targetEl);
    if (!link) return;

    const menu = new Menu();
    (menu as any).addSections([
      'title',
      'open',
      'selection',
      'clipboard',
      'action',
      'view',
      'info',
      '',
      'danger',
    ]);
    (app.workspace as any).handleExternalLinkContextMenu(menu, link.href);
    menu.showAtMouseEvent(evt);
  });
  contentEl.on('click', 'a.tag', (evt: MouseEvent, targetEl: HTMLElement) => {
    if (evt.button !== 0) return;

    const tag = targetEl.getText();
    const searchPlugin = (app as any).internalPlugins.getPluginById('global-search');
    const stateManager = view.plugin.getStateManager(view.file);
    const tagAction = stateManager.getSetting('tag-action');

    if (tagAction === 'kanban') {
      view.emitter.emit('hotkey', { commandId: 'editor:open-search', data: tag });
    } else if (searchPlugin) {
      searchPlugin.instance.openGlobalSearch(`tag:${tag}`);
    }
  });
}
