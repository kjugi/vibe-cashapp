import { useLayoutEffect, useRef } from 'react'

export function BlockingProgress({ title, detail }: { title: string; detail: string }) {
  const ref = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const blockDismiss = (event: Event) => {
      event.preventDefault()
    }
    dialog.addEventListener('cancel', blockDismiss)
    dialog.showModal()
    return () => {
      dialog.removeEventListener('cancel', blockDismiss)
      if (dialog.open) dialog.close()
    }
  }, [])

  return (
    <dialog ref={ref} className="blocking-dialog" aria-labelledby="blocking-title" aria-describedby="blocking-detail">
      <div className="blocking-card">
        <span className="spinner spinner-lg" aria-hidden="true" />
        <p id="blocking-title">{title}</p>
        <p id="blocking-detail" className="muted">
          {detail}
        </p>
      </div>
    </dialog>
  )
}
