import { DEFAULT_FILTERS, type Filters } from "./filters";
import type { MapProblem } from "../map/startup";
import type { TrailMinutes } from "./urlState";
import type { TrailsStatus } from "../map/recentTrailsLayer";
import { INITIAL_STATUS, type FeedStatus } from "./poller";

/** Reactive UI state shared by components. */
export const ui = $state({
  status: INITIAL_STATUS as FeedStatus,
  selected: null as string | null,
  airport: null as string | null,
  filters: DEFAULT_FILTERS as Filters,
  trails: 0 as TrailMinutes,
  globe: false,
  trailsStatus: { state: "off", shown: 0, total: 0 } as TrailsStatus,
  aircraftCount: 0,
  zoom: 5,
  problem: null as MapProblem | null,
  basemapNotice: false,
});
