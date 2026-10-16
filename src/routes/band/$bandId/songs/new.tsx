import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { songs } from "~/api/client"
import { SongForm, emptySong } from "~/components/SongForm"

export const Route = createFileRoute("/band/$bandId/songs/new")({
  component: NewSong,
})

function NewSong() {
  const { bandId } = Route.useParams()
  const router = useRouter()

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Add a song</h1>

      <SongForm
        pwid="song-form"
        defaults={emptySong()}
        submitLabel="Add song"
        pendingLabel="Saving…"
        onSubmit={async (payload) => {
          await songs.create({ ...payload, band_id: bandId })
          await router.invalidate()
          await router.navigate({ to: "/band/$bandId/songs", params: { bandId } })
        }}
      >
        <Link
          to="/band/$bandId/songs"
          params={{ bandId }}
          data-pwid="song-cancel"
          className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
        >
          Cancel
        </Link>
      </SongForm>
    </div>
  )
}
