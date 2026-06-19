import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sifty",
    short_name: "Sifty",
    description:
      "AI-first productivity app with instant capture, background triage, and calm task management.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e1014",
    theme_color: "#0e1014",
  };
}
