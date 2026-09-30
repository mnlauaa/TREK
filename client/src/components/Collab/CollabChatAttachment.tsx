import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '../../i18n'

export function CollabChatAttachment({ attachment }: { attachment: { url: string; original_name?: string; mime_type?: string } }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const alt = attachment.original_name || t('collab.chat.attachedImage')
  useEffect(() => { if (open) dialog.current?.showModal() }, [open])
  return <>
    <button type="button" onClick={() => setOpen(true)} style={{ display: 'block', padding: 0, border: 0, background: 'none', maxWidth: '100%', cursor: 'zoom-in', marginTop: 4 }}>
      <img src={attachment.url} alt={alt} style={{ display: 'block', width: 180, maxWidth: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 10 }} />
    </button>
    {open && <dialog ref={dialog} aria-label={alt} onCancel={() => setOpen(false)}
      onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
      onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
      style={{ position: 'fixed', inset: 0, margin: 0, border: 0, width: '100vw', height: '100dvh', maxWidth: 'none', maxHeight: 'none', background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <button type="button" aria-label={t('collab.chat.closeImage')} onClick={() => setOpen(false)} style={{ position: 'fixed', top: 18, right: 18, background: 'rgba(255,255,255,.15)', color: '#fff', border: 0, borderRadius: '50%', width: 36, height: 36 }}><X size={20} /></button>
      <img src={attachment.url} alt={alt} style={{ maxWidth: '95vw', maxHeight: '90vh', objectFit: 'contain' }} />
    </dialog>}
  </>
}
