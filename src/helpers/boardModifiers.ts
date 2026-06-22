import update from 'immutability-helper';
import { moment } from 'obsidian';
import { KanbanView } from 'src/KanbanView';
import { StateManager } from 'src/StateManager';
import { Path } from 'src/dnd/types';
import {
  appendEntities,
  getEntityFromPath,
  insertEntity,
  moveEntity,
  prependEntities,
  removeEntity,
  updateEntity,
  updateParentEntity,
} from 'src/dnd/util/data';

import { generateInstanceId } from '../components/helpers';
import { Board, DataTypes, Item, Lane } from '../components/types';
import {
  addColumn,
  addSwimlane,
  deleteColumn,
  deleteSwimlane,
  getCardId,
  renameColumn,
  renameSwimlane,
  reorderColumn,
  reorderColumnTo,
  reorderSwimlane,
  reorderSwimlaneTo,
  setCardColor,
  setCardDisplayMode,
  setCardPreviewSize,
  setColumnColor,
  setSwimlaneColor,
  setSwimlaneCollapsed,
} from './swimlanes';

export interface BoardModifiers {
  appendItems: (path: Path, items: Item[]) => void;
  prependItems: (path: Path, items: Item[]) => void;
  insertItems: (path: Path, items: Item[]) => void;
  replaceItem: (path: Path, items: Item[]) => void;
  splitItem: (path: Path, items: Item[]) => void;
  moveItemToTop: (path: Path) => void;
  moveItemToBottom: (path: Path) => void;
  addLane: (lane: Lane) => void;
  insertLane: (path: Path, lane: Lane) => void;
  updateLane: (path: Path, lane: Lane) => void;
  archiveLane: (path: Path) => void;
  archiveLaneItems: (path: Path) => void;
  deleteEntity: (path: Path) => void;
  updateItem: (path: Path, item: Item) => void;
  archiveItem: (path: Path) => void;
  duplicateEntity: (path: Path) => void;
  addSwimlane: (title: string) => void;
  addColumn: (title: string) => void;
  renameSwimlane: (swimlaneId: string, title: string) => void;
  renameColumn: (columnId: string, title: string) => void;
  deleteSwimlane: (swimlaneId: string) => void;
  deleteColumn: (columnId: string) => void;
  deleteSwimlaneAndMove: (swimlaneId: string, moveToSwimlaneId?: string) => void;
  deleteColumnAndMove: (columnId: string, moveToColumnId?: string) => void;
  reorderSwimlane: (swimlaneId: string, direction: -1 | 1) => void;
  reorderColumn: (columnId: string, direction: -1 | 1) => void;
  reorderSwimlaneTo: (sourceSwimlaneId: string, targetSwimlaneId: string) => void;
  reorderColumnTo: (sourceColumnId: string, targetColumnId: string) => void;
  setSwimlaneCollapsed: (swimlaneId: string, collapsed: boolean) => void;
  setSwimlaneColor: (swimlaneId: string, color: string) => void;
  setColumnColor: (columnId: string, color: string) => void;
  setCardColor: (path: Path, color: string) => void;
  setCardDisplayMode: (path: Path, displayMode: 'compact' | 'preview' | 'expanded') => void;
  setCardPreviewSize: (path: Path, width: number, height: number) => void;
}

export function getBoardModifiers(view: KanbanView, stateManager: StateManager): BoardModifiers {
  const appendArchiveDate = (item: Item) => {
    const archiveDateFormat = stateManager.getSetting('archive-date-format');
    const archiveDateSeparator = stateManager.getSetting('archive-date-separator');
    const archiveDateAfterTitle = stateManager.getSetting('append-archive-date');

    const newTitle = [moment().format(archiveDateFormat)];

    if (archiveDateSeparator) newTitle.push(archiveDateSeparator);

    newTitle.push(item.data.titleRaw);

    if (archiveDateAfterTitle) newTitle.reverse();

    const titleRaw = newTitle.join(' ');
    return stateManager.updateItemContent(item, titleRaw);
  };

  const ensureItemBlockId = (boardData: Board, path: Path) => {
    let item = getEntityFromPath(boardData, path) as Item;
    if (!item.data.blockId) {
      item = update(item, {
        data: {
          blockId: {
            $set: generateInstanceId(6),
          },
        },
      });
      boardData = updateParentEntity(boardData, path, {
        children: {
          [path[path.length - 1]]: {
            $set: stateManager.updateItemContent(item, item.data.titleRaw),
          },
        },
      });
      item = getEntityFromPath(boardData, path) as Item;
    }

    return { boardData, item };
  };

  const touchItem = (boardData: Board, path: Path) => {
    const item = getEntityFromPath(boardData, path) as Item;
    return updateParentEntity(boardData, path, {
      children: {
        [path[path.length - 1]]: {
          $set: { ...item },
        },
      },
    });
  };

  return {
    appendItems: (path: Path, items: Item[]) => {
      stateManager.setState((boardData) => appendEntities(boardData, path, items));
    },

    prependItems: (path: Path, items: Item[]) => {
      stateManager.setState((boardData) => prependEntities(boardData, path, items));
    },

    insertItems: (path: Path, items: Item[]) => {
      stateManager.setState((boardData) => insertEntity(boardData, path, items));
    },

    replaceItem: (path: Path, items: Item[]) => {
      stateManager.setState((boardData) =>
        insertEntity(removeEntity(boardData, path), path, items)
      );
    },

    splitItem: (path: Path, items: Item[]) => {
      stateManager.setState((boardData) => {
        return insertEntity(removeEntity(boardData, path), path, items);
      });
    },

    moveItemToTop: (path: Path) => {
      stateManager.setState((boardData) => moveEntity(boardData, path, [path[0], 0]));
    },

    moveItemToBottom: (path: Path) => {
      stateManager.setState((boardData) => {
        const laneIndex = path[0];
        const lane = boardData.children[laneIndex];
        return moveEntity(boardData, path, [laneIndex, lane.children.length]);
      });
    },

    addLane: (lane: Lane) => {
      stateManager.setState((boardData) => {
        const collapseState = view.getViewState('list-collapse') || [];
        const op = (collapseState: boolean[]) => {
          const newState = [...collapseState];
          newState.push(false);
          return newState;
        };

        view.setViewState('list-collapse', undefined, op);
        return update<Board>(appendEntities(boardData, [], [lane]), {
          data: { settings: { 'list-collapse': { $set: op(collapseState) } } },
        });
      });
    },

    insertLane: (path: Path, lane: Lane) => {
      stateManager.setState((boardData) => {
        const collapseState = view.getViewState('list-collapse');
        const op = (collapseState: boolean[]) => {
          const newState = [...collapseState];
          newState.splice(path.last(), 0, false);
          return newState;
        };

        view.setViewState('list-collapse', undefined, op);

        return update<Board>(insertEntity(boardData, path, [lane]), {
          data: { settings: { 'list-collapse': { $set: op(collapseState) } } },
        });
      });
    },

    updateLane: (path: Path, lane: Lane) => {
      stateManager.setState((boardData) =>
        updateParentEntity(boardData, path, {
          children: {
            [path[path.length - 1]]: {
              $set: lane,
            },
          },
        })
      );
    },

    archiveLane: (path: Path) => {
      stateManager.setState((boardData) => {
        const lane = getEntityFromPath(boardData, path);
        const items = lane.children;

        try {
          const collapseState = view.getViewState('list-collapse');
          const op = (collapseState: boolean[]) => {
            const newState = [...collapseState];
            newState.splice(path.last(), 1);
            return newState;
          };
          view.setViewState('list-collapse', undefined, op);

          return update<Board>(removeEntity(boardData, path), {
            data: {
              settings: { 'list-collapse': { $set: op(collapseState) } },
              archive: {
                $unshift: stateManager.getSetting('archive-with-date')
                  ? items.map(appendArchiveDate)
                  : items,
              },
            },
          });
        } catch (e) {
          stateManager.setError(e);
          return boardData;
        }
      });
    },

    archiveLaneItems: (path: Path) => {
      stateManager.setState((boardData) => {
        const lane = getEntityFromPath(boardData, path);
        const items = lane.children;

        try {
          return update(
            updateEntity(boardData, path, {
              children: {
                $set: [],
              },
            }),
            {
              data: {
                archive: {
                  $unshift: stateManager.getSetting('archive-with-date')
                    ? items.map(appendArchiveDate)
                    : items,
                },
              },
            }
          );
        } catch (e) {
          stateManager.setError(e);
          return boardData;
        }
      });
    },

    deleteEntity: (path: Path) => {
      stateManager.setState((boardData) => {
        const entity = getEntityFromPath(boardData, path);

        if (entity.type === DataTypes.Lane) {
          const collapseState = view.getViewState('list-collapse');
          const op = (collapseState: boolean[]) => {
            const newState = [...collapseState];
            newState.splice(path.last(), 1);
            return newState;
          };
          view.setViewState('list-collapse', undefined, op);

          return update<Board>(removeEntity(boardData, path), {
            data: { settings: { 'list-collapse': { $set: op(collapseState) } } },
          });
        }

        return removeEntity(boardData, path);
      });
    },

    updateItem: (path: Path, item: Item) => {
      stateManager.setState((boardData) => {
        return updateParentEntity(boardData, path, {
          children: {
            [path[path.length - 1]]: {
              $set: item,
            },
          },
        });
      });
    },

    archiveItem: (path: Path) => {
      stateManager.setState((boardData) => {
        const item = getEntityFromPath(boardData, path);
        try {
          return update(removeEntity(boardData, path), {
            data: {
              archive: {
                $push: [
                  stateManager.getSetting('archive-with-date') ? appendArchiveDate(item) : item,
                ],
              },
            },
          });
        } catch (e) {
          stateManager.setError(e);
          return boardData;
        }
      });
    },

    duplicateEntity: (path: Path) => {
      stateManager.setState((boardData) => {
        const entity = getEntityFromPath(boardData, path);
        const entityWithNewID = update(entity, {
          id: {
            $set: generateInstanceId(),
          },
        });

        if (entity.type === DataTypes.Lane) {
          const collapseState = view.getViewState('list-collapse');
          const op = (collapseState: boolean[]) => {
            const newState = [...collapseState];
            newState.splice(path.last(), 0, collapseState[path.last()]);
            return newState;
          };
          view.setViewState('list-collapse', undefined, op);

          return update<Board>(insertEntity(boardData, path, [entityWithNewID]), {
            data: { settings: { 'list-collapse': { $set: op(collapseState) } } },
          });
        }

        return insertEntity(boardData, path, [entityWithNewID]);
      });
    },

    addSwimlane: (title: string) => {
      stateManager.setState((boardData) => addSwimlane(boardData, title));
    },

    addColumn: (title: string) => {
      stateManager.setState((boardData) => addColumn(boardData, title));
    },

    renameSwimlane: (swimlaneId: string, title: string) => {
      stateManager.setState((boardData) => renameSwimlane(boardData, swimlaneId, title));
    },

    renameColumn: (columnId: string, title: string) => {
      stateManager.setState((boardData) => renameColumn(boardData, columnId, title));
    },

    deleteSwimlane: (swimlaneId: string) => {
      stateManager.setState((boardData) => deleteSwimlane(boardData, swimlaneId));
    },

    deleteColumn: (columnId: string) => {
      stateManager.setState((boardData) => deleteColumn(boardData, columnId));
    },

    deleteSwimlaneAndMove: (swimlaneId: string, moveToSwimlaneId?: string) => {
      stateManager.setState((boardData) => deleteSwimlane(boardData, swimlaneId, moveToSwimlaneId));
    },

    deleteColumnAndMove: (columnId: string, moveToColumnId?: string) => {
      stateManager.setState((boardData) => deleteColumn(boardData, columnId, moveToColumnId));
    },

    reorderSwimlane: (swimlaneId: string, direction: -1 | 1) => {
      stateManager.setState((boardData) => reorderSwimlane(boardData, swimlaneId, direction));
    },

    reorderColumn: (columnId: string, direction: -1 | 1) => {
      stateManager.setState((boardData) => reorderColumn(boardData, columnId, direction));
    },

    reorderSwimlaneTo: (sourceSwimlaneId: string, targetSwimlaneId: string) => {
      stateManager.setState((boardData) =>
        reorderSwimlaneTo(boardData, sourceSwimlaneId, targetSwimlaneId)
      );
    },

    reorderColumnTo: (sourceColumnId: string, targetColumnId: string) => {
      stateManager.setState((boardData) => reorderColumnTo(boardData, sourceColumnId, targetColumnId));
    },

    setSwimlaneCollapsed: (swimlaneId: string, collapsed: boolean) => {
      stateManager.setState((boardData) => setSwimlaneCollapsed(boardData, swimlaneId, collapsed));
    },

    setSwimlaneColor: (swimlaneId: string, color: string) => {
      stateManager.setState((boardData) => setSwimlaneColor(boardData, swimlaneId, color));
    },

    setColumnColor: (columnId: string, color: string) => {
      stateManager.setState((boardData) => setColumnColor(boardData, columnId, color));
    },

    setCardColor: (path: Path, color: string) => {
      stateManager.setState((boardData) => {
        const result = ensureItemBlockId(boardData, path);
        return touchItem(setCardColor(result.boardData, getCardId(result.item), color), path);
      });
    },

    setCardDisplayMode: (path: Path, displayMode: 'compact' | 'preview' | 'expanded') => {
      stateManager.setState((boardData) => {
        const result = ensureItemBlockId(boardData, path);
        return touchItem(
          setCardDisplayMode(result.boardData, getCardId(result.item), displayMode),
          path
        );
      });
    },

    setCardPreviewSize: (path: Path, width: number, height: number) => {
      stateManager.setState((boardData) => {
        const result = ensureItemBlockId(boardData, path);
        return touchItem(
          setCardPreviewSize(result.boardData, getCardId(result.item), width, height),
          path
        );
      });
    },
  };
}
