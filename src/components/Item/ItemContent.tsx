import { EditorView } from '@codemirror/view';
import { memo } from 'preact/compat';
import {
  Dispatch,
  StateUpdater,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { StateManager } from 'src/StateManager';
import { useNestedEntityPath } from 'src/dnd/components/Droppable';
import { Path } from 'src/dnd/types';
import { getCardConfig } from 'src/helpers/swimlanes';
import { getTaskStatusDone, toggleTaskString } from 'src/parsers/helpers/inlineMetadata';

import { MarkdownEditor, allowNewLine } from '../Editor/MarkdownEditor';
import {
  MarkdownClonedPreviewRenderer,
  MarkdownRenderer,
} from '../MarkdownRenderer/MarkdownRenderer';
import { KanbanContext, SearchContext } from '../context';
import { c, useGetDateColorFn, useGetTagColorFn } from '../helpers';
import { EditState, EditingState, Item, isEditing } from '../types';
import { DateAndTime, RelativeDate } from './DateAndTime';
import { InlineMetadata } from './InlineMetadata';
import {
  constructDatePicker,
  constructMenuDatePickerOnChange,
  constructMenuTimePickerOnChange,
  constructTimePicker,
} from './helpers';

export function useDatePickers(item: Item, explicitPath?: Path) {
  const { stateManager, boardModifiers } = useContext(KanbanContext);
  const path = explicitPath || useNestedEntityPath();

  return useMemo(() => {
    const onEditDate = (e: MouseEvent) => {
      constructDatePicker(
        e.view,
        stateManager,
        { x: e.clientX, y: e.clientY },
        constructMenuDatePickerOnChange({
          stateManager,
          boardModifiers,
          item,
          hasDate: true,
          path,
        }),
        item.data.metadata.date?.toDate()
      );
    };

    const onEditTime = (e: MouseEvent) => {
      constructTimePicker(
        e.view, // Preact uses real events, so this is safe
        stateManager,
        { x: e.clientX, y: e.clientY },
        constructMenuTimePickerOnChange({
          stateManager,
          boardModifiers,
          item,
          hasTime: true,
          path,
        }),
        item.data.metadata.time
      );
    };

    return {
      onEditDate,
      onEditTime,
    };
  }, [boardModifiers, path, item, stateManager]);
}

export interface ItemContentProps {
  item: Item;
  setEditState: Dispatch<StateUpdater<EditState>>;
  searchQuery?: string;
  showMetadata?: boolean;
  editState: EditState;
  isStatic: boolean;
}

function checkCheckbox(stateManager: StateManager, title: string, checkboxIndex: number) {
  let count = 0;

  const lines = title.split(/\n\r?/g);
  const results: string[] = [];

  lines.forEach((line) => {
    if (count > checkboxIndex) {
      results.push(line);
      return;
    }

    const match = line.match(/^(\s*>)*(\s*[-+*]\s+?\[)([^\]])(\]\s+)/);

    if (match) {
      if (count === checkboxIndex) {
        const updates = toggleTaskString(line, stateManager.file);
        if (updates) {
          results.push(updates);
        } else {
          const check = match[3] === ' ' ? getTaskStatusDone() : ' ';
          const m1 = match[1] ?? '';
          const m2 = match[2] ?? '';
          const m4 = match[4] ?? '';
          results.push(m1 + m2 + check + m4 + line.slice(match[0].length));
        }
      } else {
        results.push(line);
      }
      count++;
      return;
    }

    results.push(line);
  });

  return results.join('\n');
}

function NotePreview({ item, path, isStatic }: { item: Item; path: Path; isStatic: boolean }) {
  const { stateManager, boardModifiers, view } = useContext(KanbanContext);
  const win = view.getWindow();
  const cardConfig = getCardConfig(stateManager.state, item);
  const mode = cardConfig?.displayMode || 'compact';
  const saveTimerRef = useRef<number | null>(null);
  const draftRef = useRef('');
  const lastSavedRef = useRef('');
  const commitRef = useRef<(content: string) => void>(() => {});
  const [isPreviewEditing, setIsPreviewEditing] = useState(false);
  const file =
    item.data.metadata.file ||
    (item.data.metadata.fileAccessor
      ? stateManager.app.metadataCache.getFirstLinkpathDest(
          item.data.metadata.fileAccessor.target,
          stateManager.file.path
        )
      : null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [size, setSize] = useState({
    width: cardConfig?.previewWidth || (mode === 'expanded' ? 420 : 280),
    height: cardConfig?.previewHeight || (mode === 'expanded' ? 360 : 180),
  });

  useEffect(() => {
    setSize({
      width: cardConfig?.previewWidth || (mode === 'expanded' ? 420 : 280),
      height: cardConfig?.previewHeight || (mode === 'expanded' ? 360 : 180),
    });
  }, [cardConfig?.previewWidth, cardConfig?.previewHeight, mode]);

  useEffect(() => {
    let cancelled = false;
    if (mode === 'compact') {
      setMarkdown(null);
      setIsPreviewEditing(false);
      return;
    }

    if (isStatic) return;

    if (!file) {
      draftRef.current = item.data.titleRaw;
      lastSavedRef.current = item.data.titleRaw;
      setMarkdown(item.data.titleRaw);
      return;
    }

    stateManager.app.vault.cachedRead(file).then((content) => {
      if (!cancelled) {
        draftRef.current = content;
        lastSavedRef.current = content;
        setMarkdown(content);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [file, isStatic, item.data.titleRaw, mode, stateManager]);

  const commitPreviewContent = useCallback(
    (content: string) => {
      if (content === lastSavedRef.current) return;
      lastSavedRef.current = content;

      if (file) {
        void stateManager.app.vault.modify(file, content);
      } else {
        boardModifiers.updateItem(path, stateManager.updateItemContent(item, content));
      }
    },
    [boardModifiers, file, item, path, stateManager]
  );

  commitRef.current = commitPreviewContent;

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        win.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      commitRef.current(draftRef.current);
    };
  }, [win]);

  const savePreviewContent = useCallback(
    (content: string) => {
      draftRef.current = content;

      if (saveTimerRef.current !== null) {
        win.clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = win.setTimeout(() => {
        saveTimerRef.current = null;
        commitPreviewContent(draftRef.current);
      }, 600);
    },
    [commitPreviewContent, win]
  );

  const flushPreviewContent = useCallback(() => {
    if (saveTimerRef.current !== null) {
      win.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    commitPreviewContent(draftRef.current);
    setIsPreviewEditing(false);
  }, [commitPreviewContent, win]);

  const startResize = useCallback(
    (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const win = event.view;
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = size.width;
      const startHeight = size.height;
      let nextSize = size;

      const onMove = (moveEvent: PointerEvent) => {
        nextSize = {
          width: Math.max(220, startWidth + moveEvent.clientX - startX),
          height: Math.max(120, startHeight + moveEvent.clientY - startY),
        };
        setSize(nextSize);
      };

      const onEnd = () => {
        win.removeEventListener('pointermove', onMove);
        win.removeEventListener('pointerup', onEnd);
        win.removeEventListener('pointercancel', onEnd);
        boardModifiers.setCardPreviewSize(path, nextSize.width, nextSize.height);
      };

      win.addEventListener('pointermove', onMove);
      win.addEventListener('pointerup', onEnd);
      win.addEventListener('pointercancel', onEnd);
    },
    [boardModifiers, path, size]
  );

  if (mode === 'compact') return null;

  const previewStyle = {
    '--note-preview-width': `${size.width}px`,
    '--note-preview-height': `${size.height}px`,
  } as any;

  if (isStatic) {
    return (
      <div className={c('note-preview-card')} style={previewStyle} aria-hidden={true}>
        <div className={c('note-preview-content')} />
      </div>
    );
  }

  const shouldEditInline = isPreviewEditing;

  return (
    <div
      // eslint-disable-next-line react/no-unknown-property
      onDblClick={(event) => event.stopPropagation()}
      className={c('note-preview-card')}
      style={previewStyle}
    >
      {markdown === null ? (
        <div className={c('note-preview-content')} />
      ) : shouldEditInline ? (
        <div className={c('note-preview-editor')} data-ignore-drag={true}>
          <textarea
            key={`${file?.path || item.id}-${mode}`}
            className={c('note-preview-input')}
            value={markdown}
            spellCheck={true}
            onInput={(event) => {
              const value = (event.currentTarget as HTMLTextAreaElement).value;
              setMarkdown(value);
              savePreviewContent(value);
            }}
            onBlur={flushPreviewContent}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                (event.currentTarget as HTMLTextAreaElement).blur();
              }
            }}
          />
        </div>
      ) : (
        <MarkdownRenderer
          entityId={`${item.id}-note-preview`}
          className={c('note-preview-content')}
          markdownString={markdown}
          data-ignore-drag={true}
          onDblClick={(event) => {
            event.stopPropagation();
            setIsPreviewEditing(true);
          }}
        />
      )}
      <div
        className={c('note-preview-resize')}
        data-ignore-drag={true}
        onPointerDown={startResize as any}
      />
    </div>
  );
}

export function Tags({
  tags,
  searchQuery,
  alwaysShow,
}: {
  tags?: string[];
  searchQuery?: string;
  alwaysShow?: boolean;
}) {
  const { stateManager } = useContext(KanbanContext);
  const getTagColor = useGetTagColorFn(stateManager);
  const search = useContext(SearchContext);
  const shouldShow = stateManager.useSetting('move-tags') || alwaysShow;

  if (!tags.length || !shouldShow) return null;

  return (
    <div className={c('item-tags')}>
      {tags.map((tag, i) => {
        const tagColor = getTagColor(tag);

        return (
          <a
            href={tag}
            onClick={(e) => {
              e.preventDefault();

              const tagAction = stateManager.getSetting('tag-action');
              if (search && tagAction === 'kanban') {
                search.search(tag, true);
                return;
              }

              (stateManager.app as any).internalPlugins
                .getPluginById('global-search')
                .instance.openGlobalSearch(`tag:${tag}`);
            }}
            key={i}
            className={`tag ${c('item-tag')} ${
              searchQuery && tag.toLocaleLowerCase().contains(searchQuery) ? 'is-search-match' : ''
            }`}
            style={
              tagColor && {
                '--tag-color': tagColor.color,
                '--tag-background': tagColor.backgroundColor,
              }
            }
          >
            <span>{tag[0]}</span>
            {tag.slice(1)}
          </a>
        );
      })}
    </div>
  );
}

export const ItemContent = memo(function ItemContent({
  item,
  editState,
  setEditState,
  searchQuery,
  showMetadata = true,
  isStatic,
}: ItemContentProps) {
  const { stateManager, filePath, boardModifiers } = useContext(KanbanContext);
  const getDateColor = useGetDateColorFn(stateManager);
  const titleRef = useRef<string | null>(null);

  useEffect(() => {
    if (editState === EditingState.complete) {
      if (titleRef.current !== null) {
        boardModifiers.updateItem(path, stateManager.updateItemContent(item, titleRef.current));
      }
      titleRef.current = null;
    } else if (editState === EditingState.cancel) {
      titleRef.current = null;
    }
  }, [editState, stateManager, item]);

  const path = useNestedEntityPath();
  const { onEditDate, onEditTime } = useDatePickers(item);
  const onEnter = useCallback(
    (cm: EditorView, mod: boolean, shift: boolean) => {
      if (!allowNewLine(stateManager, mod, shift)) {
        setEditState(EditingState.complete);
        return true;
      }
    },
    [stateManager]
  );

  const onWrapperClick = useCallback(
    (e: MouseEvent) => {
      if (e.targetNode.instanceOf(HTMLElement)) {
        if (e.targetNode.hasClass(c('item-metadata-date'))) {
          onEditDate(e);
        } else if (e.targetNode.hasClass(c('item-metadata-time'))) {
          onEditTime(e);
        }
      }
    },
    [onEditDate, onEditTime]
  );

  const onSubmit = useCallback(() => setEditState(EditingState.complete), []);

  const onEscape = useCallback(() => {
    setEditState(EditingState.cancel);
    return true;
  }, [item]);

  const onCheckboxContainerClick = useCallback(
    (e: PointerEvent) => {
      const target = e.target as HTMLElement;

      if (target.hasClass('task-list-item-checkbox')) {
        if (target.dataset.src) {
          return;
        }

        const checkboxIndex = parseInt(target.dataset.checkboxIndex, 10);
        const checked = checkCheckbox(stateManager, item.data.titleRaw, checkboxIndex);
        const updated = stateManager.updateItemContent(item, checked);

        boardModifiers.updateItem(path, updated);
      }
    },
    [path, boardModifiers, stateManager, item]
  );

  if (!isStatic && isEditing(editState)) {
    return (
      <div className={c('item-input-wrapper')}>
        <MarkdownEditor
          editState={editState}
          className={c('item-input')}
          onEnter={onEnter}
          onEscape={onEscape}
          onSubmit={onSubmit}
          value={item.data.titleRaw}
          onChange={(update) => {
            if (update.docChanged) {
              titleRef.current = update.state.doc.toString().trim();
            }
          }}
        />
      </div>
    );
  }

  return (
    <div onClick={onWrapperClick} className={c('item-title')}>
      {isStatic ? (
        <MarkdownClonedPreviewRenderer
          entityId={item.id}
          className={c('item-markdown')}
          markdownString={item.data.title}
          searchQuery={searchQuery}
          onPointerUp={onCheckboxContainerClick}
        />
      ) : (
        <MarkdownRenderer
          entityId={item.id}
          className={c('item-markdown')}
          markdownString={item.data.title}
          searchQuery={searchQuery}
          onPointerUp={onCheckboxContainerClick}
        />
      )}
      {showMetadata && (
        <div className={c('item-metadata')}>
          <RelativeDate item={item} stateManager={stateManager} />
          <DateAndTime
            item={item}
            stateManager={stateManager}
            filePath={filePath}
            getDateColor={getDateColor}
          />
          <InlineMetadata item={item} stateManager={stateManager} />
          <Tags tags={item.data.metadata.tags} searchQuery={searchQuery} />
        </div>
      )}
      <NotePreview item={item} path={path} isStatic={isStatic} />
    </div>
  );
});
