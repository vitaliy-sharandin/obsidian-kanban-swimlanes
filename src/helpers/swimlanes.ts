import update from 'immutability-helper';
import { KanbanSettings } from 'src/Settings';
import {
  Board,
  CardConfig,
  CardDisplayMode,
  ColumnConfig,
  Item,
  Lane,
  LaneTemplate,
  SwimlaneConfig,
} from 'src/components/types';
import { generateInstanceId } from 'src/components/helpers';

export const swimlanesFormat = 'swimlanes-v1';
export const defaultSwimlaneId = 'default';
export const defaultSwimlaneTitle = 'Swimlane';
export const unassignedSwimlaneId = 'unassigned';
export const unassignedColumnId = 'unassigned';
export const unassignedTitle = 'Unassigned';

export function isSwimlaneBoard(board: Board) {
  return (
    board?.data?.settings?.['kanban-format'] === swimlanesFormat ||
    board?.children?.some((lane) => lane.data.isSwimlaneCell)
  );
}

export function slugId(title: string, fallback: string) {
  const slug = title
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
}

function dedupeConfig<T extends SwimlaneConfig | ColumnConfig>(configs: T[]) {
  const seen = new Set<string>();
  return configs.filter((config) => {
    if (seen.has(config.id)) return false;
    seen.add(config.id);
    return true;
  });
}

export function sortConfig<T extends SwimlaneConfig | ColumnConfig>(configs: T[]) {
  return [...configs].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });
}

export function getSwimlaneConfigs(board: Board): SwimlaneConfig[] {
  const fromSettings = board.data.settings.swimlanes || [];
  const fromLanes = board.children
    .filter((lane) => lane.data.isSwimlaneCell)
    .map((lane, index) => ({
      id: lane.data.swimlaneId || defaultSwimlaneId,
      title: lane.data.swimlaneTitle || defaultSwimlaneTitle,
      color: lane.data.swimlaneColor,
      collapsed: lane.data.swimlaneCollapsed,
      order: lane.data.swimlaneOrder ?? (index + 1) * 1000,
    }));

  return sortConfig(dedupeConfig([...fromSettings, ...fromLanes]));
}

export function getColumnConfigs(board: Board): ColumnConfig[] {
  const fromSettings = board.data.settings.columns || [];
  const fromLanes = board.children
    .filter((lane) => lane.data.isSwimlaneCell)
    .map((lane, index) => ({
      id: lane.data.columnId || slugId(lane.data.title, `column-${index + 1}`),
      title: lane.data.columnTitle || lane.data.title,
      color: lane.data.columnColor,
      order: lane.data.columnOrder ?? (index + 1) * 1000,
    }));

  return sortConfig(dedupeConfig([...fromSettings, ...fromLanes]));
}

export function createCellLane(
  swimlane: SwimlaneConfig,
  column: ColumnConfig,
  children: Item[] = []
) {
  return {
    ...LaneTemplate,
    id: generateInstanceId(),
    children,
    data: {
      title: column.title,
      isSwimlaneCell: true,
      swimlaneId: swimlane.id,
      swimlaneTitle: swimlane.title,
      swimlaneColor: swimlane.color,
      swimlaneCollapsed: swimlane.collapsed,
      swimlaneOrder: swimlane.order,
      columnId: column.id,
      columnTitle: column.title,
      columnColor: column.color,
      columnOrder: column.order,
      shouldMarkItemsComplete: false,
    },
  } as Lane;
}

export function ensureSwimlaneSettings(settings: KanbanSettings, board: Board): KanbanSettings {
  return {
    ...settings,
    'kanban-format': swimlanesFormat,
    columns: getColumnConfigs(board),
    swimlanes: getSwimlaneConfigs(board),
  };
}

export function getCellLane(board: Board, swimlaneId: string, columnId: string) {
  return board.children.find(
    (lane) => lane.data.swimlaneId === swimlaneId && lane.data.columnId === columnId
  );
}

export function getCardId(item: Item) {
  return item.data.blockId || item.id;
}

export function getCardConfig(board: Board, item: Item): CardConfig | undefined {
  const cards = board.data.settings.cards || [];
  return cards.find((card) => card.id === item.data.blockId) || cards.find((card) => card.id === item.id);
}

export function normalizeSwimlaneBoard(board: Board): Board {
  const swimlanes = getSwimlaneConfigs(board);
  const columns = getColumnConfigs(board);
  const existing = new Map<string, Lane>();

  board.children.forEach((lane) => {
    if (lane.data.isSwimlaneCell && lane.data.swimlaneId && lane.data.columnId) {
      existing.set(`${lane.data.swimlaneId}/${lane.data.columnId}`, lane);
    }
  });

  const lanes: Lane[] = [];
  swimlanes.forEach((swimlane) => {
    columns.forEach((column) => {
      const key = `${swimlane.id}/${column.id}`;
      const lane = existing.get(key);
      lanes.push(
        lane
          ? update(lane, {
              data: {
                title: { $set: column.title },
                swimlaneTitle: { $set: swimlane.title },
                swimlaneColor: { $set: swimlane.color },
                swimlaneCollapsed: { $set: swimlane.collapsed },
                swimlaneOrder: { $set: swimlane.order },
                columnTitle: { $set: column.title },
                columnColor: { $set: column.color },
                columnOrder: { $set: column.order },
              },
            })
          : createCellLane(swimlane, column)
      );
    });
  });

  return update(board, {
    children: { $set: lanes },
    data: {
      settings: {
        $set: {
          ...board.data.settings,
          'kanban-format': swimlanesFormat,
          columns,
          swimlanes,
        },
      },
    },
  });
}

export function convertBoardToSwimlanes(board: Board) {
  if (isSwimlaneBoard(board)) {
    return normalizeSwimlaneBoard(board);
  }

  const swimlane: SwimlaneConfig = {
    id: defaultSwimlaneId,
    title: defaultSwimlaneTitle,
    order: 1000,
  };

  const columns: ColumnConfig[] = board.children.map((lane, index) => ({
    id: slugId(lane.data.title, `column-${index + 1}`),
    title: lane.data.title,
    color: lane.data.columnColor,
    order: (index + 1) * 1000,
  }));

  return update(board, {
    children: {
      $set: board.children.map((lane, index) =>
        update(lane, {
          data: {
            isSwimlaneCell: { $set: true },
            swimlaneId: { $set: swimlane.id },
            swimlaneTitle: { $set: swimlane.title },
            swimlaneOrder: { $set: swimlane.order },
            columnId: { $set: columns[index].id },
            columnTitle: { $set: columns[index].title },
            columnOrder: { $set: columns[index].order },
          },
        })
      ),
    },
    data: {
      settings: {
        $set: {
          ...board.data.settings,
          'kanban-format': swimlanesFormat,
          columns,
          swimlanes: [swimlane],
        },
      },
    },
  });
}

export function addSwimlane(board: Board, title: string) {
  const columns = getColumnConfigs(board);
  const swimlanes = getSwimlaneConfigs(board);
  const swimlane: SwimlaneConfig = {
    id: slugId(title, `swimlane-${swimlanes.length + 1}`),
    title,
    order: (swimlanes[swimlanes.length - 1]?.order || 0) + 1000,
  };

  return normalizeSwimlaneBoard(
    update(board, {
      children: { $push: columns.map((column) => createCellLane(swimlane, column)) },
      data: {
        settings: {
          $set: {
            ...board.data.settings,
            'kanban-format': swimlanesFormat,
            columns,
            swimlanes: [...swimlanes, swimlane],
          },
        },
      },
    })
  );
}

export function setSwimlaneCollapsed(board: Board, swimlaneId: string, collapsed: boolean) {
  const swimlanes = getSwimlaneConfigs(board).map((swimlane) =>
    swimlane.id === swimlaneId ? { ...swimlane, collapsed } : swimlane
  );

  return normalizeSwimlaneBoard(
    update(board, {
      data: { settings: { $set: { ...board.data.settings, swimlanes } } },
    })
  );
}

export function addColumn(board: Board, title: string) {
  const columns = getColumnConfigs(board);
  const swimlanes = getSwimlaneConfigs(board);
  const column: ColumnConfig = {
    id: slugId(title, `column-${columns.length + 1}`),
    title,
    order: (columns[columns.length - 1]?.order || 0) + 1000,
  };

  return normalizeSwimlaneBoard(
    update(board, {
      children: { $push: swimlanes.map((swimlane) => createCellLane(swimlane, column)) },
      data: {
        settings: {
          $set: {
            ...board.data.settings,
            'kanban-format': swimlanesFormat,
            columns: [...columns, column],
            swimlanes,
          },
        },
      },
    })
  );
}

export function renameSwimlane(board: Board, swimlaneId: string, title: string) {
  const swimlanes = getSwimlaneConfigs(board).map((swimlane) =>
    swimlane.id === swimlaneId ? { ...swimlane, title } : swimlane
  );

  return normalizeSwimlaneBoard(
    update(board, {
      children: {
        $set: board.children.map((lane) =>
          lane.data.swimlaneId === swimlaneId
            ? update(lane, { data: { swimlaneTitle: { $set: title } } })
            : lane
        ),
      },
      data: { settings: { $set: { ...board.data.settings, swimlanes } } },
    })
  );
}

export function renameColumn(board: Board, columnId: string, title: string) {
  const columns = getColumnConfigs(board).map((column) =>
    column.id === columnId ? { ...column, title } : column
  );

  return normalizeSwimlaneBoard(
    update(board, {
      children: {
        $set: board.children.map((lane) =>
          lane.data.columnId === columnId
            ? update(lane, {
                data: {
                  title: { $set: title },
                  columnTitle: { $set: title },
                },
              })
            : lane
        ),
      },
      data: { settings: { $set: { ...board.data.settings, columns } } },
    })
  );
}

export function setSwimlaneColor(board: Board, swimlaneId: string, color: string) {
  const swimlanes = getSwimlaneConfigs(board).map((swimlane) =>
    swimlane.id === swimlaneId ? { ...swimlane, color: color || undefined } : swimlane
  );

  return normalizeSwimlaneBoard(
    update(board, {
      data: { settings: { $set: { ...board.data.settings, swimlanes } } },
    })
  );
}

export function setColumnColor(board: Board, columnId: string, color: string) {
  const columns = getColumnConfigs(board).map((column) =>
    column.id === columnId ? { ...column, color: color || undefined } : column
  );

  return normalizeSwimlaneBoard(
    update(board, {
      data: { settings: { $set: { ...board.data.settings, columns } } },
    })
  );
}

export function reorderSwimlane(board: Board, swimlaneId: string, direction: -1 | 1) {
  const swimlanes = getSwimlaneConfigs(board);
  const index = swimlanes.findIndex((swimlane) => swimlane.id === swimlaneId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= swimlanes.length) return board;

  const reordered = [...swimlanes];
  reordered.splice(target, 0, reordered.splice(index, 1)[0]);

  return normalizeSwimlaneBoard(
    update(board, {
      data: {
        settings: {
          $set: {
            ...board.data.settings,
            swimlanes: reordered.map((swimlane, i) => ({ ...swimlane, order: (i + 1) * 1000 })),
          },
        },
      },
    })
  );
}

export function reorderSwimlaneTo(board: Board, sourceId: string, targetId: string) {
  const swimlanes = getSwimlaneConfigs(board);
  const sourceIndex = swimlanes.findIndex((swimlane) => swimlane.id === sourceId);
  const targetIndex = swimlanes.findIndex((swimlane) => swimlane.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return board;

  const reordered = [...swimlanes];
  reordered.splice(targetIndex, 0, reordered.splice(sourceIndex, 1)[0]);

  return normalizeSwimlaneBoard(
    update(board, {
      data: {
        settings: {
          $set: {
            ...board.data.settings,
            swimlanes: reordered.map((swimlane, i) => ({ ...swimlane, order: (i + 1) * 1000 })),
          },
        },
      },
    })
  );
}

export function reorderColumn(board: Board, columnId: string, direction: -1 | 1) {
  const columns = getColumnConfigs(board);
  const index = columns.findIndex((column) => column.id === columnId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= columns.length) return board;

  const reordered = [...columns];
  reordered.splice(target, 0, reordered.splice(index, 1)[0]);

  return normalizeSwimlaneBoard(
    update(board, {
      data: {
        settings: {
          $set: {
            ...board.data.settings,
            columns: reordered.map((column, i) => ({ ...column, order: (i + 1) * 1000 })),
          },
        },
      },
    })
  );
}

export function reorderColumnTo(board: Board, sourceId: string, targetId: string) {
  const columns = getColumnConfigs(board);
  const sourceIndex = columns.findIndex((column) => column.id === sourceId);
  const targetIndex = columns.findIndex((column) => column.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return board;

  const reordered = [...columns];
  reordered.splice(targetIndex, 0, reordered.splice(sourceIndex, 1)[0]);

  return normalizeSwimlaneBoard(
    update(board, {
      data: {
        settings: {
          $set: {
            ...board.data.settings,
            columns: reordered.map((column, i) => ({ ...column, order: (i + 1) * 1000 })),
          },
        },
      },
    })
  );
}

function ensureMoveSwimlane(board: Board, sourceId: string, destinationId?: string) {
  const swimlanes = getSwimlaneConfigs(board).filter((swimlane) => swimlane.id !== sourceId);
  if (destinationId && swimlanes.some((swimlane) => swimlane.id === destinationId)) {
    return { board, destinationId };
  }

  const fallback: SwimlaneConfig = {
    id: unassignedSwimlaneId,
    title: unassignedTitle,
    order: (swimlanes[swimlanes.length - 1]?.order || 0) + 1000,
  };

  return {
    board: normalizeSwimlaneBoard(
      update(board, {
        data: {
          settings: {
            $set: {
              ...board.data.settings,
              swimlanes: [...swimlanes, fallback],
            },
          },
        },
      })
    ),
    destinationId: fallback.id,
  };
}

function ensureMoveColumn(board: Board, sourceId: string, destinationId?: string) {
  const columns = getColumnConfigs(board).filter((column) => column.id !== sourceId);
  if (destinationId && columns.some((column) => column.id === destinationId)) {
    return { board, destinationId };
  }

  const fallback: ColumnConfig = {
    id: unassignedColumnId,
    title: unassignedTitle,
    order: (columns[columns.length - 1]?.order || 0) + 1000,
  };

  return {
    board: normalizeSwimlaneBoard(
      update(board, {
        data: {
          settings: {
            $set: {
              ...board.data.settings,
              columns: [...columns, fallback],
            },
          },
        },
      })
    ),
    destinationId: fallback.id,
  };
}

export function deleteSwimlane(board: Board, swimlaneId: string, moveToSwimlaneId?: string) {
  let workingBoard = board;

  if (moveToSwimlaneId !== undefined) {
    const ensured = ensureMoveSwimlane(workingBoard, swimlaneId, moveToSwimlaneId);
    workingBoard = ensured.board;
    moveToSwimlaneId = ensured.destinationId;
    workingBoard = update(workingBoard, {
      children: {
        $set: workingBoard.children.map((lane) =>
          update(lane, { children: { $set: [...lane.children] } })
        ),
      },
    });

    workingBoard.children.forEach((lane) => {
      if (lane.data.swimlaneId !== swimlaneId || !lane.children.length) return;
      const target = getCellLane(workingBoard, moveToSwimlaneId, lane.data.columnId);
      if (target) {
        target.children.push(...lane.children);
      }
    });
  }

  const swimlanes = getSwimlaneConfigs(workingBoard).filter(
    (swimlane) => swimlane.id !== swimlaneId
  );

  return normalizeSwimlaneBoard(
    update(workingBoard, {
      children: {
        $set: workingBoard.children.filter((lane) => lane.data.swimlaneId !== swimlaneId),
      },
      data: { settings: { $set: { ...workingBoard.data.settings, swimlanes } } },
    })
  );
}

export function deleteColumn(board: Board, columnId: string, moveToColumnId?: string) {
  let workingBoard = board;

  if (moveToColumnId !== undefined) {
    const ensured = ensureMoveColumn(workingBoard, columnId, moveToColumnId);
    workingBoard = ensured.board;
    moveToColumnId = ensured.destinationId;
    workingBoard = update(workingBoard, {
      children: {
        $set: workingBoard.children.map((lane) =>
          update(lane, { children: { $set: [...lane.children] } })
        ),
      },
    });

    workingBoard.children.forEach((lane) => {
      if (lane.data.columnId !== columnId || !lane.children.length) return;
      const target = getCellLane(workingBoard, lane.data.swimlaneId, moveToColumnId);
      if (target) {
        target.children.push(...lane.children);
      }
    });
  }

  const columns = getColumnConfigs(workingBoard).filter((column) => column.id !== columnId);

  return normalizeSwimlaneBoard(
    update(workingBoard, {
      children: { $set: workingBoard.children.filter((lane) => lane.data.columnId !== columnId) },
      data: { settings: { $set: { ...workingBoard.data.settings, columns } } },
    })
  );
}

export function updateCardConfig(
  board: Board,
  cardId: string,
  patch: Partial<Omit<CardConfig, 'id'>>
) {
  const cards = board.data.settings.cards || [];
  const index = cards.findIndex((card) => card.id === cardId);
  const next = index >= 0 ? { ...cards[index], ...patch } : { id: cardId, ...patch };

  const cleaned = Object.keys(next).reduce((acc, key) => {
    const value = next[key as keyof CardConfig];
    if (value !== undefined && value !== '') {
      (acc as any)[key] = value;
    }
    return acc;
  }, {} as CardConfig);

  const nextCards =
    Object.keys(cleaned).length <= 1
      ? cards.filter((card) => card.id !== cardId)
      : index >= 0
        ? cards.map((card, i) => (i === index ? cleaned : card))
        : [...cards, cleaned];

  return update(board, {
    data: {
      settings: {
        $set: {
          ...board.data.settings,
          cards: nextCards,
        },
      },
    },
  });
}

export function setCardColor(board: Board, cardId: string, color: string) {
  return updateCardConfig(board, cardId, { color: color || undefined });
}

export function setCardDisplayMode(board: Board, cardId: string, displayMode: CardDisplayMode) {
  return updateCardConfig(board, cardId, { displayMode });
}

export function setCardPreviewSize(
  board: Board,
  cardId: string,
  previewWidth: number,
  previewHeight: number
) {
  return updateCardConfig(board, cardId, { previewWidth, previewHeight });
}
