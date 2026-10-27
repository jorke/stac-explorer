type IconName = 'layers' | 'arrow' | 'search' | 'globe' | 'close' | 'external' | 'back' | 'link'
type IconSize = 13 | 14 | 15 | 16 | 18 | 19 | 20 | 24

const paths = {
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  arrow: <path d="m9 5 7 7-7 7" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  external: (
    <>
      <path d="M14 3h7v7m0-7L10 14" />
      <path d="M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6" />
    </>
  ),
  back: <path d="m14 5-7 7 7 7" />,
  link: (
    <>
      <path d="m10 13 4-4M8 15l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0M13 8l1-1a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0" />
    </>
  ),
}

export default function Icon({ name, size = 20 }: { name: IconName; size?: IconSize }) {
  return (
    <svg className={`icon icon-${size}`} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
