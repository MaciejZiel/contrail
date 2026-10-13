import { INITIAL_STATUS, type FeedStatus } from "./poller";

/** Reactive UI state shared by components. */
export const ui = $state({
  status: INITIAL_STATUS as FeedStatus,
  selected: null as string | null,
  aircraftCount: 0,
  zoom: 5,
  webglError: "",
});
