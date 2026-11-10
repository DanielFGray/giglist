import { HttpApi } from "effect/http-api"
import { AuthApiGroup } from "./auth"
import { BandsApiGroup, PublicBandsApiGroup } from "./bands"
import { ChartsApiGroup, ScoresApiGroup } from "./charts"
import { GigsApiGroup } from "./gigs"
import { MarksApiGroup, StampsApiGroup } from "./marks"
import { PublicUsersApiGroup } from "./public-users"
import { SetlistsApiGroup } from "./setlists"
import { SongsApiGroup } from "./songs"

// --- Unified API ---

export const GigListApi = HttpApi.make("GigListApi")
  .add(AuthApiGroup)
  .add(BandsApiGroup)
  .add(PublicBandsApiGroup)
  .add(PublicUsersApiGroup)
  .add(SongsApiGroup)
  .add(SetlistsApiGroup)
  .add(GigsApiGroup)
  .add(ChartsApiGroup)
  .add(ScoresApiGroup)
  .add(MarksApiGroup)
  .add(StampsApiGroup)
