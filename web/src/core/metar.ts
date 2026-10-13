import type { MetarData } from "./api";

export function windText(m: MetarData): string {
  if (m.wind_kt === null) return "–";
  if (m.wind_kt === 0) return "Calm";
  const dir = m.wind_variable ? "Variable" : m.wind_dir === null ? "" : `${String(m.wind_dir).padStart(3, "0")}°`;
  const gust = m.gust_kt ? `, gusts ${Math.round(m.gust_kt)} kt` : "";
  return `${dir} ${Math.round(m.wind_kt)} kt${gust}`.trim();
}

export function visibilityText(m: MetarData): string {
  if (m.visibility_m === null) return "–";
  const km = m.visibility_m / 1000;
  const txt = km >= 10 ? "10 km" : km >= 1 ? `${km.toFixed(km >= 5 ? 0 : 1)} km` : `${Math.round(m.visibility_m / 100) * 100} m`;
  return m.visibility_plus && km >= 5 ? `${txt} or more` : txt;
}

export function cloudsText(m: MetarData): string {
  const layers = m.clouds.filter((c) => c.cover && c.cover !== "CLR" && c.cover !== "SKC");
  if (layers.length === 0) return "Clear";
  const names: Record<string, string> = { FEW: "Few", SCT: "Scattered", BKN: "Broken", OVC: "Overcast", VV: "Vertical visibility" };
  return layers
    .map((c) => `${names[c.cover] ?? c.cover}${c.base_ft === null ? "" : ` ${Math.round(c.base_ft).toLocaleString("en")} ft`}`)
    .join(" · ");
}

export function tempText(m: MetarData): string {
  if (m.temp_c === null) return "–";
  return m.dewpoint_c === null ? `${m.temp_c} °C` : `${m.temp_c} °C, dew point ${m.dewpoint_c} °C`;
}

export function pressureText(m: MetarData): string {
  return m.qnh_hpa === null ? "–" : `${Math.round(m.qnh_hpa)} hPa`;
}

export const CATEGORY_LABEL: Record<string, string> = {
  VFR: "Visual conditions",
  MVFR: "Marginal visual",
  IFR: "Instrument conditions",
  LIFR: "Low instrument conditions",
};
