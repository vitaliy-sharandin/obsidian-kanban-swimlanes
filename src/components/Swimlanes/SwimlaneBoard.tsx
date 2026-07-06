import classcat from 'classcat';
import { App, FuzzySuggestModal, Menu, Modal, Setting, TFile } from 'obsidian';
import {
  Fragment,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/compat';
import { addColorMenuItem } from 'src/components/ColorPickerPopover';
import { Icon } from 'src/components/Icon/Icon';
import { DraggableLane } from 'src/components/Lane/Lane';
import { KanbanContext, SearchContext } from 'src/components/context';
import { c } from 'src/components/helpers';
import { Board, ColumnConfig, EditState, Item, SwimlaneConfig } from 'src/components/types';
import {
  getCellLane,
  getRenderableColumnConfigs,
  getRenderableSwimlaneConfigs,
  isImplicitDefaultColumn,
  isImplicitDefaultSwimlane,
  unassignedColumnId,
  unassignedSwimlaneId,
  unassignedTitle,
} from 'src/helpers/swimlanes';

interface SwimlaneBoardProps {
  boardData: Board;
}

type HeaderDragType = 'column' | 'swimlane';
type HeaderDragPlacement = 'before' | 'after';

type HeaderDragState = {
  type: HeaderDragType;
  sourceId: string;
  targetId?: string;
  placement?: HeaderDragPlacement;
  offsetX: number;
  offsetY: number;
  orderIds: string[];
};

function areOrdersEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function getDragOrderKey(dragState: HeaderDragState | null) {
  return dragState
    ? `${dragState.type}:${dragState.sourceId}:${dragState.orderIds.join('|')}`
    : null;
}

function getAnimatedRects(root: HTMLElement) {
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>('[data-swimlane-anim-key]')
  );
  const visualRects = new Map<string, DOMRect>();
  const animatedKeys = new Set<string>();
  const previousTransforms = new Map<HTMLElement, string>();

  elements.forEach((element) => {
    const key = element.dataset.swimlaneAnimKey;
    if (key) {
      visualRects.set(key, element.getBoundingClientRect());
      if (element.getAnimations().length) {
        animatedKeys.add(key);
      }
    }

    element.getAnimations().forEach((animation) => animation.cancel());
    previousTransforms.set(element, element.style.transform);
    element.style.transform = '';
  });

  const rects = new Map<string, DOMRect>();
  elements.forEach((element) => {
    const key = element.dataset.swimlaneAnimKey;
    if (key) {
      rects.set(key, element.getBoundingClientRect());
    }
  });

  elements.forEach((element) => {
    element.style.transform = previousTransforms.get(element) || '';
  });

  return { animatedKeys, elements, rects, visualRects };
}

function isDragSourceKey(key: string, type: HeaderDragType, sourceId: string) {
  const parts = key.split(':');

  if (type === 'column') {
    return (
      key === `column-frame:${sourceId}` ||
      key === `column-header:${sourceId}` ||
      (parts[0] === 'cell' && parts[2] === sourceId)
    );
  }

  return (
    key === `swimlane-frame:${sourceId}` ||
    key === `swimlane-header:${sourceId}` ||
    key === `swimlane-collapsed:${sourceId}` ||
    (parts[0] === 'cell' && parts[1] === sourceId)
  );
}

class TextInputModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private initialValue: string,
    private onSubmit: (value: string) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });

    let value = this.initialValue;
    let inputEl: HTMLInputElement;

    new Setting(contentEl).addText((text) => {
      inputEl = text.inputEl;
      text.setValue(this.initialValue);
      text.onChange((next) => {
        value = next;
      });
      text.inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          const trimmed = value.trim();
          if (trimmed) {
            this.onSubmit(trimmed);
            this.close();
          }
        }
      });
    });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText('Cancel')
          .onClick(() => this.close())
      )
      .addButton((button) =>
        button
          .setCta()
          .setButtonText('Save')
          .onClick(() => {
            const trimmed = value.trim();
            if (trimmed) {
              this.onSubmit(trimmed);
              this.close();
            }
          })
      );

    this.containerEl.win.setTimeout(() => inputEl?.focus());
  }

  onClose() {
    this.contentEl.empty();
  }
}

function openTextInput(app: App, title: string, initialValue: string, onSubmit: (value: string) => void) {
  new TextInputModal(app, title, initialValue, onSubmit).open();
}

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private sourcePath: string,
    private onChoose: (link: string) => void
  ) {
    super(app);
    this.setPlaceholder('Add note to this cell...');
  }

  getItems() {
    return this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourcePath);
  }

  getItemText(file: TFile) {
    return file.path;
  }

  onChooseItem(file: TFile) {
    this.onChoose(this.app.fileManager.generateMarkdownLink(file, this.sourcePath));
  }
}

export const SwimlaneBoard = memo(function SwimlaneBoard({ boardData }: SwimlaneBoardProps) {
  const { boardModifiers, stateManager, view } = useContext(KanbanContext);
  const search = useContext(SearchContext);
  const columns = useMemo(() => getRenderableColumnConfigs(boardData), [boardData]);
  const swimlanes = useMemo(() => getRenderableSwimlaneConfigs(boardData), [boardData]);
  const hideColumnHeaders = columns.length === 1 && isImplicitDefaultColumn(columns[0]);
  const hideSwimlaneHeaders =
    swimlanes.length === 1 && isImplicitDefaultSwimlane(swimlanes[0]);
  const counts = useMemo(() => {
    const columnCounts = new Map<string, number>();
    const swimlaneCounts = new Map<string, number>();
    let total = 0;

    boardData.children.forEach((lane) => {
      const count = lane.children.length;
      total += count;
      if (lane.data.columnId) {
        columnCounts.set(lane.data.columnId, (columnCounts.get(lane.data.columnId) || 0) + count);
      }
      if (lane.data.swimlaneId) {
        swimlaneCounts.set(
          lane.data.swimlaneId,
          (swimlaneCounts.get(lane.data.swimlaneId) || 0) + count
        );
      }
    });

    return { columnCounts, swimlaneCounts, total };
  }, [boardData]);
  const [dragState, setDragState] = useState<HeaderDragState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const layoutRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const dragStartRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const dragOrderKeyRef = useRef<string | null>(null);
  const headerDragRef = useRef<{
    type: HeaderDragType;
    sourceId: string;
    pointerId: number;
    startX: number;
    startY: number;
    isDragging: boolean;
    ids: string[];
    targetId?: string;
    placement?: HeaderDragPlacement;
    offsetX: number;
    offsetY: number;
    sourceRect?: DOMRect;
  } | null>(null);
  const renderColumns = useMemo(() => {
    if (dragState?.type !== 'column') return columns;

    const byId = new Map(columns.map((column) => [column.id, column]));
    const ordered = dragState.orderIds
      .map((id) => byId.get(id))
      .filter((column): column is ColumnConfig => !!column);

    return ordered.length === columns.length ? ordered : columns;
  }, [columns, dragState]);
  const renderSwimlanes = useMemo(() => {
    if (dragState?.type !== 'swimlane') return swimlanes;

    const byId = new Map(swimlanes.map((swimlane) => [swimlane.id, swimlane]));
    const ordered = dragState.orderIds
      .map((id) => byId.get(id))
      .filter((swimlane): swimlane is SwimlaneConfig => !!swimlane);

    return ordered.length === swimlanes.length ? ordered : swimlanes;
  }, [dragState, swimlanes]);
  const ignoreNextHeaderClickRef = useRef(false);
  const win = view.getWindow();
  const app = view.app;

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const orderKey = getDragOrderKey(dragState);
    if (dragState && dragOrderKeyRef.current === orderKey) {
      const sourceStartRects = dragStartRectsRef.current;
      const layoutRects = layoutRectsRef.current;

      if (sourceStartRects && layoutRects) {
        Array.from(grid.querySelectorAll<HTMLElement>('[data-swimlane-anim-key]')).forEach(
          (element) => {
            const key = element.dataset.swimlaneAnimKey;
            if (!key || !isDragSourceKey(key, dragState.type, dragState.sourceId)) return;

            const startRect = sourceStartRects.get(key);
            const nextRect = layoutRects.get(key);
            if (!startRect || !nextRect) return;

            const x = startRect.left + dragState.offsetX - nextRect.left;
            const y = startRect.top + dragState.offsetY - nextRect.top;
            element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            element.style.transition = 'none';
          }
        );
      }

      return;
    }

    const { animatedKeys, elements, rects, visualRects } = getAnimatedRects(grid);
    const previousRects = layoutRectsRef.current;
    const sourceStartRects = dragStartRectsRef.current;

    elements.forEach((element) => {
      const key = element.dataset.swimlaneAnimKey;
      if (!key) return;

      if (dragState && sourceStartRects && isDragSourceKey(key, dragState.type, dragState.sourceId)) {
        const startRect = sourceStartRects.get(key);
        const nextRect = rects.get(key);
        if (startRect && nextRect) {
          const x = startRect.left + dragState.offsetX - nextRect.left;
          const y = startRect.top + dragState.offsetY - nextRect.top;
          element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          element.style.transition = 'none';
        }
        return;
      }

      element.style.transform = '';
      element.style.transition = '';
    });

    if (dragState && previousRects) {
      elements.forEach((element) => {
        const key = element.dataset.swimlaneAnimKey;
        if (!key || isDragSourceKey(key, dragState.type, dragState.sourceId)) return;

        const previousRect = animatedKeys.has(key) ? visualRects.get(key) : previousRects.get(key);
        const nextRect = rects.get(key);
        if (!previousRect || !nextRect) return;

        const x = previousRect.left - nextRect.left;
        const y = previousRect.top - nextRect.top;
        if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) return;

        element.animate(
          [
            { transform: `translate3d(${x}px, ${y}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' },
          ],
          {
            duration: 170,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
          }
        );
      });
    }

    if (!dragState) {
      dragStartRectsRef.current = null;
    }

    layoutRectsRef.current = rects;
    dragOrderKeyRef.current = orderKey;
  }, [dragState, renderColumns, renderSwimlanes]);

  const showColumnMenu = useCallback(
    (event: MouseEvent, column: ColumnConfig) => {
      const hasCards = boardData.children.some(
        (lane) => lane.data.columnId === column.id && lane.children.length > 0
      );
      const menu = new Menu()
        .addItem((item) =>
          item
            .setIcon('lucide-edit-3')
            .setTitle('Rename column')
            .onClick(() => {
              openTextInput(app, 'Column name', column.title, (title) =>
                boardModifiers.renameColumn(column.id, title)
              );
            })
        )
        .addItem((item) =>
          item
            .setIcon('lucide-arrow-left')
            .setTitle('Move column left')
            .onClick(() => boardModifiers.reorderColumn(column.id, -1))
        )
        .addItem((item) =>
          item
            .setIcon('lucide-arrow-right')
            .setTitle('Move column right')
            .onClick(() => boardModifiers.reorderColumn(column.id, 1))
        );

      addColorMenuItem(
        menu,
        'Set column color',
        column.color,
        '#3b82f6',
        (color) => boardModifiers.setColumnColor(column.id, color),
        () => boardModifiers.setColumnColor(column.id, '')
      );

      menu.addSeparator();

      if (hasCards) {
        menu.addItem((item) => {
          const submenu = (item as any)
            .setIcon('lucide-move')
            .setTitle('Delete and move cards to')
            .setSubmenu();
          columns
            .filter((candidate) => candidate.id !== column.id)
            .forEach((candidate) => {
              submenu.addItem((item: any) =>
                item
                  .setIcon('lucide-columns-3')
                  .setTitle(candidate.title)
                  .onClick(() => boardModifiers.deleteColumnAndMove(column.id, candidate.id))
              );
            });
          submenu.addItem((item: any) =>
            item
              .setIcon('lucide-inbox')
              .setTitle(unassignedTitle)
              .onClick(() => boardModifiers.deleteColumnAndMove(column.id, unassignedColumnId))
          );
        });
      }

      menu
        .addItem((item) =>
          item
            .setIcon('lucide-trash-2')
            .setTitle(hasCards ? 'Delete column and cards' : 'Delete column')
            .onClick(() => boardModifiers.deleteColumn(column.id))
        )
        .showAtMouseEvent(event);
    },
    [app, boardData, boardModifiers, columns]
  );

  const showSwimlaneMenu = useCallback(
    (event: MouseEvent, swimlane: SwimlaneConfig) => {
      const hasCards = boardData.children.some(
        (lane) => lane.data.swimlaneId === swimlane.id && lane.children.length > 0
      );
      const menu = new Menu()
        .addItem((item) =>
          item
            .setIcon('lucide-edit-3')
            .setTitle('Rename swimlane')
            .onClick(() => {
              openTextInput(app, 'Swimlane name', swimlane.title, (title) =>
                boardModifiers.renameSwimlane(swimlane.id, title)
              );
            })
        )
        .addItem((item) =>
          item
            .setIcon('lucide-arrow-up')
            .setTitle('Move swimlane up')
            .onClick(() => boardModifiers.reorderSwimlane(swimlane.id, -1))
        )
        .addItem((item) =>
          item
            .setIcon('lucide-arrow-down')
            .setTitle('Move swimlane down')
            .onClick(() => boardModifiers.reorderSwimlane(swimlane.id, 1))
        )
        .addItem((item) =>
          item
            .setIcon(swimlane.collapsed ? 'lucide-chevron-down' : 'lucide-chevron-up')
            .setTitle(swimlane.collapsed ? 'Expand swimlane' : 'Collapse swimlane')
            .onClick(() => boardModifiers.setSwimlaneCollapsed(swimlane.id, !swimlane.collapsed))
        );

      addColorMenuItem(
        menu,
        'Set swimlane color',
        swimlane.color,
        '#64748b',
        (color) => boardModifiers.setSwimlaneColor(swimlane.id, color),
        () => boardModifiers.setSwimlaneColor(swimlane.id, '')
      );

      menu.addSeparator();

      if (hasCards) {
        menu.addItem((item) => {
          const submenu = (item as any)
            .setIcon('lucide-move')
            .setTitle('Delete and move cards to')
            .setSubmenu();
          swimlanes
            .filter((candidate) => candidate.id !== swimlane.id)
            .forEach((candidate) => {
              submenu.addItem((item: any) =>
                item
                  .setIcon('lucide-rows-3')
                  .setTitle(candidate.title)
                  .onClick(() => boardModifiers.deleteSwimlaneAndMove(swimlane.id, candidate.id))
              );
            });
          submenu.addItem((item: any) =>
            item
              .setIcon('lucide-inbox')
              .setTitle(unassignedTitle)
              .onClick(() =>
                boardModifiers.deleteSwimlaneAndMove(swimlane.id, unassignedSwimlaneId)
              )
          );
        });
      }

      menu
        .addItem((item) =>
          item
            .setIcon('lucide-trash-2')
            .setTitle(hasCards ? 'Delete swimlane and cards' : 'Delete swimlane')
            .onClick(() => boardModifiers.deleteSwimlane(swimlane.id))
        )
        .showAtMouseEvent(event);
    },
    [app, boardData, boardModifiers, swimlanes]
  );

  const addSwimlane = useCallback(() => {
    openTextInput(app, 'Swimlane name', '', (title) => boardModifiers.addSwimlane(title));
  }, [app, boardModifiers]);

  const addColumn = useCallback(() => {
    openTextInput(app, 'Column name', '', (title) => boardModifiers.addColumn(title));
  }, [app, boardModifiers]);

  const showAddMenu = useCallback(
    (event: MouseEvent) => {
      new Menu()
        .addItem((item) =>
          item
            .setIcon('lucide-rows-3')
            .setTitle('Add swimlane')
            .onClick(addSwimlane)
        )
        .addItem((item) =>
          item
            .setIcon('lucide-columns-3')
            .setTitle('Add column')
            .onClick(addColumn)
        )
        .showAtMouseEvent(event);
    },
    [addColumn, addSwimlane]
  );

  const openNoteSearch = useCallback(
    (addItems: (items: Item[]) => void) => {
      new NoteSuggestModal(app, stateManager.file.path, (link) => {
        addItems([stateManager.getNewItem(link, ' ')]);
      }).open();
    },
    [app, stateManager]
  );

  const stopFilterEvent = useCallback((event: Event) => {
    event.stopPropagation();
  }, []);

  const renderCellActions = useCallback(
    ({
      addItems,
      setEditState,
    }: {
      addItems: (items: Item[]) => void;
      setEditState: (editState: EditState) => void;
    }) => (
      <div className={c('swimlane-cell-actions')}>
        <button
          className={c('swimlane-cell-action')}
          onClick={() => setEditState({ x: 0, y: 0 })}
        >
          <span className={c('item-button-plus')}>+</span> Add card
        </button>
        <button className={c('swimlane-cell-action')} onClick={() => openNoteSearch(addItems)}>
          <span className={c('item-button-plus')}>+</span> Add note
        </button>
      </div>
    ),
    [openNoteSearch]
  );

  const getHeaderDragClasses = useCallback(
    (type: HeaderDragType, id: string) => ({
      'is-drag-source': dragState?.type === type && dragState.sourceId === id,
      'is-drop-target': dragState?.type === type && dragState.targetId === id,
      'is-drop-before':
        dragState?.type === type && dragState.targetId === id && dragState.placement === 'before',
      'is-drop-after':
        dragState?.type === type && dragState.targetId === id && dragState.placement === 'after',
    }),
    [dragState]
  );

  const getCellDragClasses = useCallback(
    (columnId: string, swimlaneId: string) => ({
      'is-column-drag-source':
        dragState?.type === 'column' && dragState.sourceId === columnId,
      'is-column-drop-target':
        dragState?.type === 'column' && dragState.targetId === columnId,
      'is-column-drop-before':
        dragState?.type === 'column' &&
        dragState.targetId === columnId &&
        dragState.placement === 'before',
      'is-column-drop-after':
        dragState?.type === 'column' &&
        dragState.targetId === columnId &&
        dragState.placement === 'after',
      'is-swimlane-drag-source':
        dragState?.type === 'swimlane' && dragState.sourceId === swimlaneId,
      'is-swimlane-drop-target':
        dragState?.type === 'swimlane' && dragState.targetId === swimlaneId,
      'is-swimlane-drop-before':
        dragState?.type === 'swimlane' &&
        dragState.targetId === swimlaneId &&
        dragState.placement === 'before',
      'is-swimlane-drop-after':
        dragState?.type === 'swimlane' &&
        dragState.targetId === swimlaneId &&
        dragState.placement === 'after',
    }),
    [dragState]
  );

  const getHeaderDragStyle = useCallback(
    (type: HeaderDragType, id: string) => {
      if (dragState?.type !== type || dragState.sourceId !== id) return {};

      return {
        '--swimlane-drag-x': `${type === 'column' ? dragState.offsetX : 0}px`,
        '--swimlane-drag-y': `${type === 'swimlane' ? dragState.offsetY : 0}px`,
      };
    },
    [dragState]
  );

  const getCellDragStyle = useCallback(
    (columnId: string, swimlaneId: string) => {
      if (!dragState) return {};
      if (dragState.type === 'column' && dragState.sourceId === columnId) {
        return {
          '--swimlane-drag-x': `${dragState.offsetX}px`,
          '--swimlane-drag-y': '0px',
        };
      }
      if (dragState.type === 'swimlane' && dragState.sourceId === swimlaneId) {
        return {
          '--swimlane-drag-x': '0px',
          '--swimlane-drag-y': `${dragState.offsetY}px`,
        };
      }

      return {};
    },
    [dragState]
  );

  const finishHeaderDrag = useCallback(() => {
    const wasDragging = headerDragRef.current?.isDragging;
    headerDragRef.current = null;
    if (wasDragging) {
      ignoreNextHeaderClickRef.current = true;
    }
    setDragState(null);
    win.setTimeout(() => {
      ignoreNextHeaderClickRef.current = false;
    }, 150);
  }, [win]);

  const startHeaderPointerDrag = useCallback(
    (event: PointerEvent, type: HeaderDragType, sourceId: string) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      let sourceRect: DOMRect | undefined;
      if (gridRef.current) {
        const { rects } = getAnimatedRects(gridRef.current);
        dragStartRectsRef.current = rects;
        layoutRectsRef.current = rects;
        sourceRect = rects.get(`${type}-frame:${sourceId}`);
      }

      headerDragRef.current = {
        type,
        sourceId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        isDragging: false,
        ids: (type === 'column' ? columns : swimlanes).map((config) => config.id),
        offsetX: 0,
        offsetY: 0,
        sourceRect,
      };

      const frameSelector =
        type === 'column' ? '[data-kanban-column-frame-id]' : '[data-kanban-swimlane-frame-id]';
      const frameAttribute =
        type === 'column' ? 'data-kanban-column-frame-id' : 'data-kanban-swimlane-frame-id';

      const onPointerMove = (moveEvent: PointerEvent) => {
        const drag = headerDragRef.current;
        if (!drag || drag.pointerId !== moveEvent.pointerId) return;

        const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
        if (!drag.isDragging && distance < 5) return;

        moveEvent.preventDefault();
        moveEvent.stopPropagation();

        if (!drag.isDragging) {
          drag.isDragging = true;
        }

        drag.offsetX = moveEvent.clientX - drag.startX;
        drag.offsetY = moveEvent.clientY - drag.startY;

        const draggedCenter = drag.sourceRect
          ? drag.type === 'column'
            ? drag.sourceRect.left + drag.sourceRect.width / 2 + drag.offsetX
            : drag.sourceRect.top + drag.sourceRect.height / 2 + drag.offsetY
          : drag.type === 'column'
          ? moveEvent.clientX
          : moveEvent.clientY;
        const frameElements = Array.from(
          win.document.querySelectorAll<HTMLElement>(frameSelector)
        );
        const target = frameElements.find((element) => {
          const id = element.getAttribute(frameAttribute);
          const rect =
            layoutRectsRef.current?.get(`${drag.type}-frame:${id}`) ||
            element.getBoundingClientRect();

          return (
            id &&
            id !== drag.sourceId &&
            drag.ids.includes(id) &&
            (drag.type === 'column'
              ? draggedCenter >= rect.left && draggedCenter <= rect.right
              : draggedCenter >= rect.top && draggedCenter <= rect.bottom)
          );
        });
        const targetId = target?.getAttribute(frameAttribute);
        if (!targetId || targetId === drag.sourceId) {
          setDragState({
            type: drag.type,
            sourceId: drag.sourceId,
            targetId: drag.targetId,
            placement: drag.placement,
            offsetX: drag.offsetX,
            offsetY: drag.offsetY,
            orderIds: drag.ids,
          });
          return;
        }

        const rect =
          layoutRectsRef.current?.get(`${drag.type}-frame:${targetId}`) ||
          target.getBoundingClientRect();
        const targetCenter =
          drag.type === 'column' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
        const targetSize = drag.type === 'column' ? rect.width : rect.height;
        const distanceFromCenter = draggedCenter - targetCenter;
        const threshold = Math.min(56, Math.max(18, targetSize * 0.18));
        if (Math.abs(distanceFromCenter) < threshold) {
          setDragState({
            type: drag.type,
            sourceId: drag.sourceId,
            targetId: drag.targetId,
            placement: drag.placement,
            offsetX: drag.offsetX,
            offsetY: drag.offsetY,
            orderIds: drag.ids,
          });
          return;
        }

        const placement: HeaderDragPlacement = distanceFromCenter > 0 ? 'after' : 'before';
        const nextIds = drag.ids.filter((id) => id !== drag.sourceId);
        const targetIndex = nextIds.indexOf(targetId);
        if (targetIndex >= 0) {
          nextIds.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, drag.sourceId);
          if (!areOrdersEqual(nextIds, drag.ids)) {
            drag.ids = nextIds;
          }
        }

        drag.targetId = targetId;
        drag.placement = placement;
        setDragState({
          type: drag.type,
          sourceId: drag.sourceId,
          targetId,
          placement,
          offsetX: drag.offsetX,
          offsetY: drag.offsetY,
          orderIds: drag.ids,
        });
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        const drag = headerDragRef.current;
        if (drag?.pointerId !== upEvent.pointerId) return;
        win.removeEventListener('pointermove', onPointerMove);
        win.removeEventListener('pointerup', onPointerUp);
        win.removeEventListener('pointercancel', onPointerUp);

        if (drag.isDragging && drag.targetId && drag.placement) {
          if (drag.type === 'column') {
            boardModifiers.reorderColumnToPlacement(drag.sourceId, drag.targetId, drag.placement);
          } else {
            boardModifiers.reorderSwimlaneToPlacement(
              drag.sourceId,
              drag.targetId,
              drag.placement
            );
          }
        }

        finishHeaderDrag();
      };

      win.addEventListener('pointermove', onPointerMove);
      win.addEventListener('pointerup', onPointerUp);
      win.addEventListener('pointercancel', onPointerUp);
    },
    [boardModifiers, columns, finishHeaderDrag, swimlanes, win]
  );

  return (
    <div
      className={classcat([
        c('swimlane-board'),
        {
          'is-columns-only': hideSwimlaneHeaders,
          'is-swimlanes-only': hideColumnHeaders,
        },
      ])}
    >
      <div className={c('swimlane-toolbar')}>
        <div
          className={c('swimlane-filter')}
          onClick={stopFilterEvent}
          onKeyDown={stopFilterEvent}
          onKeyUp={stopFilterEvent}
          onMouseDown={stopFilterEvent}
          onPointerDown={stopFilterEvent}
        >
          <Icon name="lucide-search" />
          <input
            value={search?.query || ''}
            onBeforeInput={stopFilterEvent}
            onClick={stopFilterEvent}
            onFocus={stopFilterEvent}
            onInput={(event) => {
              event.stopPropagation();
              search?.search((event.currentTarget as HTMLInputElement).value, true, false);
            }}
            onKeyDown={stopFilterEvent}
            onKeyUp={stopFilterEvent}
            onMouseDown={stopFilterEvent}
            onPointerDown={stopFilterEvent}
            placeholder="Filter cards, tags, links..."
          />
          <span className={c('swimlane-filter-count')}>
            {search?.query ? search.items.size : counts.total}
          </span>
          {search?.query && (
            <button
              className={c('swimlane-filter-clear')}
              aria-label="Clear filter"
              onClick={(event) => {
                event.stopPropagation();
                search.search('', true, false);
              }}
            >
              <Icon name="lucide-x" />
            </button>
          )}
        </div>
        <button
          className={c('swimlane-add-menu-button')}
          aria-label="Add"
          title="Add"
          onClick={(event) => showAddMenu(event as unknown as MouseEvent)}
        >
          <Icon name="lucide-plus" />
        </button>
      </div>

      <div
        ref={gridRef}
        className={c('swimlane-grid')}
        style={{ '--swimlane-column-count': renderColumns.length } as any}
      >
        {renderColumns.map((column, columnIndex) => (
          <div
            key={`${column.id}-column-frame`}
            data-kanban-column-frame-id={column.id}
            data-swimlane-anim-key={`column-frame:${column.id}`}
            className={classcat([
              c('swimlane-column-frame'),
              {
                'is-implicit-hidden': hideColumnHeaders && isImplicitDefaultColumn(column),
                ...getHeaderDragClasses('column', column.id),
              },
            ])}
            style={
              {
                gridColumn: `${columnIndex + 2}`,
                gridRow: `1 / span ${renderSwimlanes.length + 1}`,
                '--column-color': column.color,
                ...getHeaderDragStyle('column', column.id),
              } as any
            }
            aria-hidden="true"
          />
        ))}
        {renderSwimlanes.map((swimlane, swimlaneIndex) => (
          <div
            key={`${swimlane.id}-swimlane-frame`}
            data-kanban-swimlane-frame-id={swimlane.id}
            data-swimlane-anim-key={`swimlane-frame:${swimlane.id}`}
            className={classcat([
              c('swimlane-row-frame'),
              {
                'is-implicit-hidden': hideSwimlaneHeaders && isImplicitDefaultSwimlane(swimlane),
                ...getHeaderDragClasses('swimlane', swimlane.id),
              },
            ])}
            style={
              {
                gridColumn: `1 / span ${renderColumns.length + 1}`,
                gridRow: `${swimlaneIndex + 2}`,
                '--swimlane-color': swimlane.color,
                ...getHeaderDragStyle('swimlane', swimlane.id),
              } as any
            }
            aria-hidden="true"
          />
        ))}
        <div className={c('swimlane-corner')} style={{ gridColumn: '1', gridRow: '1' }} />
        {renderColumns.map((column, columnIndex) => (
          <button
            key={column.id}
            className={classcat([
              c('swimlane-column-header'),
              {
                'is-implicit-hidden': hideColumnHeaders,
                ...getHeaderDragClasses('column', column.id),
              },
            ])}
            data-kanban-column-id={column.id}
            data-swimlane-anim-key={`column-header:${column.id}`}
            style={
              {
                gridColumn: `${columnIndex + 2}`,
                gridRow: '1',
                '--column-color': column.color,
                ...getHeaderDragStyle('column', column.id),
              } as any
            }
            onClick={(event) => {
              if (ignoreNextHeaderClickRef.current) return;
              showColumnMenu(event as unknown as MouseEvent, column);
            }}
            onPointerDown={(event) =>
              startHeaderPointerDrag(event as unknown as PointerEvent, 'column', column.id)
            }
          >
            <span className={c('swimlane-header-grip')}>
              <Icon name="lucide-grip-horizontal" />
            </span>
            <span className={c('swimlane-header-title')}>{column.title}</span>
            <span className={c('swimlane-header-count')}>
              {counts.columnCounts.get(column.id) || 0}
            </span>
          </button>
        ))}
        <button
          className={c('swimlane-add-column-button')}
          aria-label="Add column"
          title="Add column"
          style={
            {
              gridColumn: `${renderColumns.length + 2}`,
              gridRow: `1 / ${renderSwimlanes.length + 2}`,
            } as any
          }
          onClick={addColumn}
        >
          <Icon name="lucide-plus" />
          <span>Add column</span>
        </button>

        {renderSwimlanes.map((swimlane, swimlaneIndex) => (
          <Fragment key={swimlane.id}>
            {hideSwimlaneHeaders ? (
              <div
                key={`${swimlane.id}-header-spacer`}
                className={c('swimlane-row-header-spacer')}
                data-kanban-swimlane-id={swimlane.id}
                data-swimlane-anim-key={`swimlane-header:${swimlane.id}`}
                style={{ gridColumn: '1', gridRow: `${swimlaneIndex + 2}` }}
              />
            ) : (
              <button
                key={`${swimlane.id}-header`}
                className={classcat([
                  c('swimlane-row-header'),
                  {
                    'is-collapsed': swimlane.collapsed,
                    ...getHeaderDragClasses('swimlane', swimlane.id),
                  },
                ])}
                data-kanban-swimlane-id={swimlane.id}
                data-swimlane-anim-key={`swimlane-header:${swimlane.id}`}
                style={
                  {
                    gridColumn: '1',
                    gridRow: `${swimlaneIndex + 2}`,
                    '--swimlane-color': swimlane.color,
                    ...getHeaderDragStyle('swimlane', swimlane.id),
                  } as any
                }
                onClick={(event) => {
                  if (ignoreNextHeaderClickRef.current) return;
                  showSwimlaneMenu(event as unknown as MouseEvent, swimlane);
                }}
                onPointerDown={(event) =>
                  startHeaderPointerDrag(event as unknown as PointerEvent, 'swimlane', swimlane.id)
                }
              >
                <span className={c('swimlane-header-grip')}>
                  <Icon name="lucide-grip-vertical" />
                </span>
                <span className={c('swimlane-header-title')}>{swimlane.title}</span>
                <span className={c('swimlane-header-count')}>
                  {counts.swimlaneCounts.get(swimlane.id) || 0}
                </span>
              </button>
            )}

            {swimlane.collapsed ? (
              <button
                className={classcat([
                  c('swimlane-collapsed-row'),
                  getHeaderDragClasses('swimlane', swimlane.id),
                ])}
                data-kanban-swimlane-id={swimlane.id}
                data-swimlane-anim-key={`swimlane-collapsed:${swimlane.id}`}
                style={
                  {
                    gridColumn: `2 / span ${renderColumns.length}`,
                    gridRow: `${swimlaneIndex + 2}`,
                    ...getHeaderDragStyle('swimlane', swimlane.id),
                  } as any
                }
                onClick={() => boardModifiers.setSwimlaneCollapsed(swimlane.id, false)}
              >
                {swimlane.title}
              </button>
            ) : (
              renderColumns.map((column, columnIndex) => {
                const lane = getCellLane(boardData, swimlane.id, column.id);
                if (!lane) {
                  return (
                    <div
                      key={`${swimlane.id}-${column.id}`}
                      data-swimlane-anim-key={`cell:${swimlane.id}:${column.id}`}
                      style={{
                        gridColumn: `${columnIndex + 2}`,
                        gridRow: `${swimlaneIndex + 2}`,
                      }}
                    />
                  );
                }

                const laneIndex = boardData.children.indexOf(lane);
                return (
                  <div
                    key={lane.id}
                    data-kanban-column-id={column.id}
                    data-kanban-swimlane-id={swimlane.id}
                    data-swimlane-anim-key={`cell:${swimlane.id}:${column.id}`}
                    className={classcat([
                      c('swimlane-cell'),
                      {
                        'has-column-color': column.color,
                        ...getCellDragClasses(column.id, swimlane.id),
                      },
                    ])}
                    style={
                      {
                        gridColumn: `${columnIndex + 2}`,
                        gridRow: `${swimlaneIndex + 2}`,
                        '--column-color': column.color,
                        '--swimlane-color': swimlane.color,
                        ...getCellDragStyle(column.id, swimlane.id),
                      } as any
                    }
                  >
                    <DraggableLane
                      lane={lane}
                      laneIndex={laneIndex}
                      collapseDir="vertical"
                      isCollapsed={false}
                      renderActions={renderCellActions}
                    />
                  </div>
                );
              })
            )}
          </Fragment>
        ))}
        <button
          className={c('swimlane-add-swimlane-button')}
          style={
            {
              gridColumn: `1 / ${renderColumns.length + 2}`,
              gridRow: `${renderSwimlanes.length + 2}`,
            } as any
          }
          onClick={addSwimlane}
        >
          <Icon name="lucide-plus" />
          <span>Add swimlane</span>
        </button>
      </div>
    </div>
  );
});
