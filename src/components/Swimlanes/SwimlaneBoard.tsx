import classcat from 'classcat';
import { App, Menu, Modal, Setting } from 'obsidian';
import { Fragment, memo, useCallback, useContext, useMemo, useRef, useState } from 'preact/compat';
import { addColorMenuItem } from 'src/components/ColorPickerPopover';
import { DraggableLane } from 'src/components/Lane/Lane';
import { KanbanContext } from 'src/components/context';
import { c } from 'src/components/helpers';
import { Board, ColumnConfig, SwimlaneConfig } from 'src/components/types';
import {
  getCellLane,
  getColumnConfigs,
  getSwimlaneConfigs,
  unassignedColumnId,
  unassignedSwimlaneId,
  unassignedTitle,
} from 'src/helpers/swimlanes';

interface SwimlaneBoardProps {
  boardData: Board;
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

export const SwimlaneBoard = memo(function SwimlaneBoard({ boardData }: SwimlaneBoardProps) {
  const { boardModifiers, view } = useContext(KanbanContext);
  const columns = useMemo(() => getColumnConfigs(boardData), [boardData]);
  const swimlanes = useMemo(() => getSwimlaneConfigs(boardData), [boardData]);
  const [dragState, setDragState] = useState<{
    type: 'column' | 'swimlane';
    sourceId: string;
    targetId?: string;
  } | null>(null);
  const headerDragRef = useRef<{
    type: 'column' | 'swimlane';
    sourceId: string;
    pointerId: number;
    startX: number;
    startY: number;
    isDragging: boolean;
    currentIds: string[];
  } | null>(null);
  const ignoreNextHeaderClickRef = useRef(false);
  const win = view.getWindow();
  const app = view.app;

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
    (event: PointerEvent, type: 'column' | 'swimlane', sourceId: string) => {
      if (event.button !== 0) return;

      event.stopPropagation();
      headerDragRef.current = {
        type,
        sourceId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        isDragging: false,
        currentIds: (type === 'column' ? columns : swimlanes).map((config) => config.id),
      };

      const targetSelector =
        type === 'column' ? '[data-kanban-column-id]' : '[data-kanban-swimlane-id]';
      const targetAttribute =
        type === 'column' ? 'data-kanban-column-id' : 'data-kanban-swimlane-id';

      const onPointerMove = (moveEvent: PointerEvent) => {
        const drag = headerDragRef.current;
        if (!drag || drag.pointerId !== moveEvent.pointerId) return;

        const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
        if (!drag.isDragging && distance < 5) return;

        moveEvent.preventDefault();
        moveEvent.stopPropagation();

        if (!drag.isDragging) {
          drag.isDragging = true;
          setDragState({ type: drag.type, sourceId: drag.sourceId });
        }

        const target = win.document
          .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
          ?.closest(targetSelector) as HTMLElement | null;
        const targetId = target?.getAttribute(targetAttribute);
        if (!targetId || targetId === drag.sourceId) return;

        const currentIndex = drag.currentIds.indexOf(drag.sourceId);
        const withoutSource = drag.currentIds.filter((id) => id !== drag.sourceId);
        const targetIndex = withoutSource.indexOf(targetId);
        if (currentIndex < 0 || targetIndex < 0) return;

        const rect = target.getBoundingClientRect();
        const insertAfter =
          drag.type === 'column'
            ? moveEvent.clientX > rect.left + rect.width / 2
            : moveEvent.clientY > rect.top + rect.height / 2;
        const desiredIndex = targetIndex + (insertAfter ? 1 : 0);
        if (desiredIndex === currentIndex) return;

        const direction = desiredIndex > currentIndex ? 1 : -1;

        if (drag.type === 'column') {
          boardModifiers.reorderColumn(drag.sourceId, direction);
        } else {
          boardModifiers.reorderSwimlane(drag.sourceId, direction);
        }

        const [source] = drag.currentIds.splice(currentIndex, 1);
        drag.currentIds.splice(currentIndex + direction, 0, source);
        setDragState({ type: drag.type, sourceId: drag.sourceId, targetId });
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        if (headerDragRef.current?.pointerId !== upEvent.pointerId) return;
        win.removeEventListener('pointermove', onPointerMove);
        win.removeEventListener('pointerup', onPointerUp);
        win.removeEventListener('pointercancel', onPointerUp);
        finishHeaderDrag();
      };

      win.addEventListener('pointermove', onPointerMove);
      win.addEventListener('pointerup', onPointerUp);
      win.addEventListener('pointercancel', onPointerUp);
    },
    [boardModifiers, columns, finishHeaderDrag, swimlanes, win]
  );

  return (
    <div className={c('swimlane-board')}>
      <div className={c('swimlane-toolbar')}>
        <button onClick={addSwimlane}>Add swimlane</button>
        <button onClick={addColumn}>Add column</button>
      </div>

      <div
        className={c('swimlane-grid')}
        style={{ '--swimlane-column-count': columns.length } as any}
      >
        <div className={c('swimlane-corner')} />
        {columns.map((column) => (
          <button
            key={column.id}
            className={classcat([
              c('swimlane-column-header'),
              {
                'is-drag-source': dragState?.type === 'column' && dragState.sourceId === column.id,
                'is-drop-target': dragState?.type === 'column' && dragState.targetId === column.id,
              },
            ])}
            data-kanban-column-id={column.id}
            style={column.color ? ({ '--column-color': column.color } as any) : undefined}
            onClick={(event) => {
              if (ignoreNextHeaderClickRef.current) return;
              showColumnMenu(event as unknown as MouseEvent, column);
            }}
            onPointerDown={(event) =>
              startHeaderPointerDrag(event as unknown as PointerEvent, 'column', column.id)
            }
          >
            {column.title}
          </button>
        ))}

        {swimlanes.map((swimlane) => (
          <Fragment key={swimlane.id}>
            <button
              key={`${swimlane.id}-header`}
              className={classcat([
                c('swimlane-row-header'),
                {
                  'is-collapsed': swimlane.collapsed,
                  'is-drag-source':
                    dragState?.type === 'swimlane' && dragState.sourceId === swimlane.id,
                  'is-drop-target':
                    dragState?.type === 'swimlane' && dragState.targetId === swimlane.id,
                },
              ])}
              data-kanban-swimlane-id={swimlane.id}
              style={swimlane.color ? ({ '--swimlane-color': swimlane.color } as any) : undefined}
              onClick={(event) => {
                if (ignoreNextHeaderClickRef.current) return;
                showSwimlaneMenu(event as unknown as MouseEvent, swimlane);
              }}
              onPointerDown={(event) =>
                startHeaderPointerDrag(event as unknown as PointerEvent, 'swimlane', swimlane.id)
              }
            >
              {swimlane.title}
            </button>

            {swimlane.collapsed ? (
              <button
                className={c('swimlane-collapsed-row')}
                data-kanban-swimlane-id={swimlane.id}
                style={{ gridColumn: `span ${columns.length}` } as any}
                onClick={() => boardModifiers.setSwimlaneCollapsed(swimlane.id, false)}
              >
                {swimlane.title}
              </button>
            ) : columns.map((column) => {
              const lane = getCellLane(boardData, swimlane.id, column.id);
              if (!lane) return <div key={`${swimlane.id}-${column.id}`} />;

              const laneIndex = boardData.children.indexOf(lane);
              return (
                <div
                  key={lane.id}
                  data-kanban-column-id={column.id}
                  data-kanban-swimlane-id={swimlane.id}
                  className={classcat([
                    c('swimlane-cell'),
                    {
                      'has-column-color': column.color,
                      'is-column-drag-source':
                        dragState?.type === 'column' && dragState.sourceId === column.id,
                      'is-column-drop-target':
                        dragState?.type === 'column' && dragState.targetId === column.id,
                      'is-swimlane-drag-source':
                        dragState?.type === 'swimlane' && dragState.sourceId === swimlane.id,
                      'is-swimlane-drop-target':
                        dragState?.type === 'swimlane' && dragState.targetId === swimlane.id,
                    },
                  ])}
                  style={
                    {
                      '--column-color': column.color,
                      '--swimlane-color': swimlane.color,
                    } as any
                  }
                >
                  <DraggableLane
                    lane={lane}
                    laneIndex={laneIndex}
                    collapseDir="vertical"
                    isCollapsed={false}
                  />
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
});
