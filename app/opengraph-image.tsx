import { SITE_DESCRIPTION } from "@/lib/site/config";
import { ImageResponse } from "next/og";

export const alt = "Sifty — write it down, Sifty does the rest";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Dark-theme tokens from globals.css, flattened to sRGB because Satori
// does not understand oklch().
const BG = "#0d0c08";
const FG = "#ecebe7";
const MUTED = "#9a978f";
const EMBER = "#e2742a";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: BG,
        color: FG,
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "rgba(226,116,42,0.18)",
            border: "1px solid rgba(226,116,42,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 999, background: EMBER }} />
        </div>
        <div style={{ fontSize: 30, fontFamily: "Helvetica, Arial, sans-serif", fontWeight: 500 }}>
          Sifty
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 84,
            lineHeight: 1.02,
            letterSpacing: -2,
          }}
        >
          <span>Write it down.</span>
          <span>Sifty does the rest.</span>
        </div>
        <div
          style={{
            fontSize: 28,
            lineHeight: 1.4,
            color: MUTED,
            fontFamily: "Helvetica, Arial, sans-serif",
            maxWidth: 980,
          }}
        >
          {SITE_DESCRIPTION}
        </div>
      </div>
    </div>,
    size,
  );
}
