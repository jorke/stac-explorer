import { memo } from 'react'
import { dateOf } from '../util/stac'
import type { Entry } from '../util/stac'
import Icon from './Icon'

interface Props {
  entry: Entry
  selected: boolean
  onSelect: (entry: Entry) => void
}

// Selection and background metadata updates should repaint only affected rows.
export default memo(function CatalogEntry({ entry, selected, onSelect }: Props) {
  const date = dateOf(entry.document)
  return (
    <button className={`entry${selected ? ' selected' : ''}`} onClick={() => onSelect(entry)}>
      <span className={`entry-icon${entry.kind === 'Item' ? ' item-icon' : ''}`}>
        <Icon name={entry.kind === 'Item' ? 'globe' : 'layers'} size={19} />
      </span>
      <span className="entry-copy">
        <strong>{entry.title}</strong>
        {entry.description && <span className="entry-description">{entry.description}</span>}
        <span className="entry-meta">
          {entry.kind}
          {date && (
            <>
              {' '}
              <i /> {date}
            </>
          )}
        </span>
      </span>
      <Icon name="arrow" size={15} />
    </button>
  )
})
