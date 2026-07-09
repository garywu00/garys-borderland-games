import { CARD_META, type CardCode } from "@/lib/game/rules";

export function CardDisplay({ code, width = 220 }: { code: CardCode; width?: number }) {
  const meta = CARD_META[code];
  return (
    <div style={{ width, margin: "0 auto" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={meta.svg}
        alt={`${meta.label} playing card`}
        style={{ width: "100%", display: "block", filter: "drop-shadow(0 12px 30px rgba(10,10,10,0.18))" }}
      />
    </div>
  );
}

export function ProgressTrack({
  collected,
  finalist,
}: {
  collected: CardCode[];
  finalist: boolean;
}) {
  const order: (CardCode | "final")[] = ["heart4", "club8", "diamond2", "final"];
  const glyph: Record<string, string> = { heart4: "♥", club8: "♣", diamond2: "♦", final: "★" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
      {order.map((code, i) => {
        const done = code === "final" ? finalist : collected.includes(code as CardCode);
        return (
          <div key={code} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {i > 0 && <div style={{ width: 14, height: 1.6, background: "var(--line)", opacity: 0.35 }} />}
            <div
              style={{
                width: 44,
                height: 44,
                border: "1.6px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                background: done ? "var(--btn-bg)" : "transparent",
                color: done ? "var(--btn-fg)" : "var(--fg)",
                opacity: done ? 1 : 0.35,
              }}
            >
              {done ? "✓" : glyph[code]}
            </div>
          </div>
        );
      })}
    </div>
  );
}
