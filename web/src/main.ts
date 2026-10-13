import "maplibre-gl/dist/maplibre-gl.css";
import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app missing");
export default mount(App, { target });
