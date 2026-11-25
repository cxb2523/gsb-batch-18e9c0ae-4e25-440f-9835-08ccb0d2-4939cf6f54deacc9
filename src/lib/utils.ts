import { createCn } from 'cn/config'

/**
 * shadcn/ui's class helper (the `cn` package: clsx + tailwind-merge in one), taught the site's
 * type scale from styles.css. Without it `text-ui` would read as a colour and a later
 * `text-muted-foreground` would drop it.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'caption', 'ui', 'body-sm', 'body', 'lead', 'title'] }],
    },
  },
})
