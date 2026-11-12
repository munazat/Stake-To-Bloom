import type { ReactNode } from 'react'

type Tone = 'mint' | 'coral' | 'sky' | 'sun' | 'lilac'

interface PageHeadingProps {
  icon: string
  title: string
  tone?: Tone
  className?: string
  children?: ReactNode
}

export default function PageHeading({
  icon,
  title,
  tone = 'mint',
  className = '',
  children,
}: PageHeadingProps) {
  return (
    <div className={`page-heading page-heading--${tone} ${className}`}>
      <span className="page-heading-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <h1>{title}</h1>
        {children ? <div className="page-heading-description">{children}</div> : null}
      </div>
    </div>
  )
}
