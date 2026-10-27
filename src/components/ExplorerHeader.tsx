import { memo } from 'react'
import type { FormEvent } from 'react'
import Icon from './Icon'

interface Props {
  url: string
  loading: boolean
  canShare: boolean
  copyStatus: 'idle' | 'copying' | 'copied'
  onUrlChange: (url: string) => void
  onExplore: () => void
  onCopyView: () => void
}

export default memo(function ExplorerHeader({
  url,
  loading,
  canShare,
  copyStatus,
  onUrlChange,
  onExplore,
  onCopyView,
}: Props) {
  function submit(event: FormEvent) {
    event.preventDefault()
    onExplore()
  }

  return (
    <header className="header">
      <a className="brand" href={window.location.pathname} aria-label="STAC Explorer home">
        <span className="brand-icon">
          <Icon name="layers" size={24} />
        </span>
        <span>
          stac<span className="brand-light">explorer</span>
          <small>AN OPEN WINDOW INTO EARTH DATA</small>
        </span>
      </a>
      <form className="url-form" onSubmit={submit}>
        <Icon name="globe" size={19} />
        <input
          aria-label="STAC URL"
          placeholder="Paste a STAC catalog or API URL…"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          spellCheck={false}
          required
        />
        <button
          className="button share-button"
          type="button"
          aria-label="Copy link to current view"
          title="Copy this view, selected item, and overlay settings"
          disabled={!canShare || loading || copyStatus === 'copying'}
          onClick={onCopyView}
        >
          <Icon name="link" size={16} />
          <span className="share-label">{copyStatus === 'copied' ? 'Copied!' : 'Copy link'}</span>
        </button>
        <button className="button primary" type="submit" disabled={!url.trim()}>
          {loading ? <span className="spinner" /> : <Icon name="arrow" size={15} />} Explore
        </button>
      </form>
    </header>
  )
})
