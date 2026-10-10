"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// On a phone (below 721 px, where the editor has its bar at the foot) a notice goes above that bar: at the top it would sit over the
// buttons of the header, and at the foot under the bar.
const phoneQuery = "(max-width: 720px)"
const subscribePhone = (notify: () => void) => { const list = window.matchMedia(phoneQuery); list.addEventListener("change", notify); return () => list.removeEventListener("change", notify) }

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false)

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
      {...(phone ? { position: "bottom-center" as const, offset: { bottom: 68 }, mobileOffset: { bottom: 68 } } : {})}
    />
  )
}

export { Toaster }
