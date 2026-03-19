/// <reference types="vite/client" />
import type { ReactNode } from "react"
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router"
import { Nav } from "~/components/Nav"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "SetList" },
    ],
    links: [
      { rel: "stylesheet", href: "/src/styles/app.css" },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </RootDocument>
  )
}

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("setlist-theme");if(!t)t=matchMedia("(prefers-color-scheme:light)").matches?"light":"dark";document.documentElement.className=t}catch(e){document.documentElement.className="dark"}})()`

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="bg-[var(--color-surface)] text-zinc-100 antialiased min-h-screen [.light_&]:text-zinc-900">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
