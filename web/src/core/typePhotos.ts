/** Representative photos per aircraft type, stored with the app (see server/scripts/build_type_photos.py). */

export interface TypePhoto {
  file: string;
  class: string;
  title: string;
  source_url: string;
  author: string;
  license: string;
  spdx: string;
  license_url: string;
}

let manifest: Promise<Record<string, TypePhoto>> | null = null;

export function loadManifest(): Promise<Record<string, TypePhoto>> {
  manifest ??= fetch(new URL("type-photos/manifest.json", document.baseURI))
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, TypePhoto>>) : {}))
    .catch(() => ({}));
  return manifest;
}

export async function typePhoto(code: string): Promise<{ photo: TypePhoto; url: string } | null> {
  if (!code) return null;
  const entry = (await loadManifest())[code.toUpperCase()];
  return entry ? { photo: entry, url: new URL(`type-photos/${entry.file}`, document.baseURI).href } : null;
}

export type ArtKind = "airliner" | "regional" | "bizjet" | "ga" | "helicopter" | "glider" | "military" | "other";

/** Which illustration to draw when there is no photo at all. */
export function artKind(typeClass: string | null, category: string): ArtKind {
  const known: ArtKind[] = ["airliner", "regional", "bizjet", "ga", "helicopter", "glider", "military"];
  if (typeClass && (known as string[]).includes(typeClass)) return typeClass as ArtKind;
  switch (category) {
    case "light":
      return "ga";
    case "jet":
    case "heavy":
      return "airliner";
    case "rotorcraft":
      return "helicopter";
    case "glider":
      return "glider";
    default:
      return "other";
  }
}

export const ART_LABEL: Record<ArtKind, string> = {
  airliner: "Airliner",
  regional: "Regional aircraft",
  bizjet: "Business jet",
  ga: "Light aircraft",
  helicopter: "Helicopter",
  glider: "Glider",
  military: "Military aircraft",
  other: "Aircraft",
};
