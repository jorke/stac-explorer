import { memo, useEffect, useMemo, useRef } from 'react'
import { titleOf } from '../util/stac'
import type { StacDocument } from '../util/stac'
import Icon from './Icon'

function useModalDialog() {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return dialog
}

export const ShareDialog = memo(function ShareDialog({
  link,
  onClose,
}: {
  link: string
  onClose: () => void
}) {
  const dialog = useModalDialog()
  return (
    <dialog ref={dialog} className="json-dialog share-dialog" onClose={onClose}>
      <div className="json-header">
        <h2>Link to this view</h2>
        <button
          className="icon-button"
          aria-label="Close view link"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="share-content">
        <p>Copy this link to reopen the map and its selections.</p>
        <textarea
          aria-label="View link"
          readOnly
          value={link}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
    </dialog>
  )
})

export const JsonDialog = memo(function JsonDialog({
  document,
  onClose,
}: {
  document: StacDocument
  onClose: () => void
}) {
  const dialog = useModalDialog()
  const source = useMemo(() => JSON.stringify(document, null, 2), [document])
  return (
    <dialog
      ref={dialog}
      className="json-dialog"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close()
      }}
    >
      <div className="json-header">
        <div>
          <span className="eyebrow">SOURCE JSON</span>
          <h2>{titleOf(document)}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close JSON"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
      </div>
      <pre>{source}</pre>
    </dialog>
  )
})
