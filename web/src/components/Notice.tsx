import type { ReactNode } from 'react'

export type NoticeTone = 'info' | 'success' | 'warning' | 'error'

const ICONS: Record<NoticeTone, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '!',
  error: '✕',
}

interface NoticeProps {
  tone: NoticeTone
  title: string
  children?: ReactNode
  /** `alert` for errors that need attention now; `status` for routine updates. */
  live?: 'alert' | 'status' | 'none'
  id?: string
}

/** Inline, persistent message beside the control it belongs to. Tone is carried by an icon and text, never color alone. */
export function Notice({ tone, title, children, live = tone === 'error' ? 'alert' : 'status', id }: NoticeProps) {
  const role = live === 'none' ? undefined : live
  return (
    <div className={`notice notice--${tone}`} role={role} id={id}>
      <span className="notice__icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div className="notice__body">
        <p className="notice__title">{title}</p>
        {children ? <div className="notice__detail">{children}</div> : null}
      </div>
    </div>
  )
}
