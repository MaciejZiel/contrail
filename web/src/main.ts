import "./fonts.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { mount } from "svelte";
import "./app.css";
import Root from "./Root.svelte";
import { initTheme } from "./core/themeState.svelte";

initTheme(); // before the first paint, so there is no flash of the wrong theme
const target = document.getElementById("app");
if (!target) throw new Error("#app missing");
export default mount(Root, { target });
