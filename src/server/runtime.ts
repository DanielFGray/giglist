import { Layer, ManagedRuntime } from "effect"
import { Db } from "./db"

const MainLive = Layer.mergeAll(Db.Live)

export const runtime = ManagedRuntime.make(MainLive)
