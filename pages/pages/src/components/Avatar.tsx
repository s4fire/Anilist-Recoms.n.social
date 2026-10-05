import { initials } from '../lib/format'

export default function Avatar({ name, src, size = 'md', className = '' }: { name?: string | null; src?: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <span className={`avatar avatar-${size} ${className}`} aria-label={name || 'Profile'}>
    {src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <span>{initials(name)}</span>}
  </span>
}
