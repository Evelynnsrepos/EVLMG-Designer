import { openExternalUrl } from './openUrl'

/** Plain text with its https:// addresses as links that open in the browser. */
export function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https:\/\/\S+)/).map((part, i) =>
        i % 2 ? (
          <a
            key={i}
            href={part}
            onClick={(e) => {
              e.preventDefault()
              void openExternalUrl(part)
            }}
          >
            {part.replace(/^https:\/\//, '')}
          </a>
        ) : (
          part
        ),
      )}
    </>
  )
}
