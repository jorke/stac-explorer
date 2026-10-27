import { memo } from 'react'
import { dateOf, safeUrl } from '../util/stac'
import type { Entry, StacDocument } from '../util/stac'
import Icon from './Icon'

interface Props {
  entry: Entry
  onClose: () => void
  onJson: (document: StacDocument) => void
  overlayControlsRef: (node: HTMLDivElement | null) => void
}

export default memo(function ItemInspector({ entry, onClose, onJson, overlayControlsRef }: Props) {
  const document = entry.document
  if (!document) return null
  const assets = Object.entries(document.assets ?? {})
  const properties = Object.entries(document.properties ?? {})
  const thumbnail = assets.find(
    ([, asset]) =>
      asset.roles?.includes('thumbnail') &&
      (!asset.type || /^image\/(png|jpe?g|webp)/.test(asset.type)),
  )
  const image = thumbnail ? safeUrl(thumbnail[1].href, entry.baseUrl) : undefined
  const date = dateOf(document)

  return (
    <aside className="inspector" aria-label="Item details">
      <div className="inspector-top">
        <span className="eyebrow">ITEM DETAILS</span>
        <button className="icon-button" aria-label="Close item details" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="inspector-overlay" ref={overlayControlsRef} />
      <div className="inspector-content">
        {image && (
          <img
            key={image}
            className="thumbnail"
            src={image}
            alt={`Preview of ${entry.title}`}
            onError={(event) => {
              event.currentTarget.hidden = true
            }}
          />
        )}
        <span className="tag">STAC ITEM</span>
        <h2>{entry.title}</h2>
        {document.collection && <p className="collection-name">{document.collection}</p>}
        {date && <div className="item-date">{date}</div>}
        <button className="button json-button" onClick={() => onJson(document)}>
          {'{ }'} View item JSON
        </button>
        <div className="section-title">
          Assets <span className="count">{assets.length}</span>
        </div>
        <div className="asset-list">
          {assets.map(([name, asset]) => {
            const href = safeUrl(asset.href, entry.baseUrl)
            return href ? (
              <a key={name} className="asset" href={href} target="_blank" rel="noreferrer">
                <span>
                  <strong>{asset.title || name}</strong>
                  <small>
                    {name}
                    {asset.type ? ` · ${asset.type}` : ''}
                  </small>
                </span>
                <Icon name="external" size={14} />
              </a>
            ) : (
              <div key={name} className="asset unavailable">
                <span>
                  <strong>{asset.title || name}</strong>
                  <code>{asset.href}</code>
                </span>
              </div>
            )
          })}
          {!assets.length && <p className="muted">No assets listed for this item.</p>}
        </div>
        <details className="properties">
          <summary>
            Properties <span className="count">{properties.length}</span>
          </summary>
          <dl>
            {properties.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </aside>
  )
})
