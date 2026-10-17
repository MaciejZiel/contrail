import "./fonts.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { mount } from "svelte";
import "./app.css";
import Root from "./Root.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app missing");
export default mount(Root, { target });
