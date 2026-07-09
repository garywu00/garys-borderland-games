function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Portrait({
  name,
  photoUrl,
  size = 32,
  style,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: "var(--portrait-bg)",
        border: "1.6px solid var(--line)",
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        boxShadow: "0 0 0 2px var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontSize: Math.max(11, Math.round(size * 0.32)),
        ...style,
      }}
      aria-label={photoUrl ? `${name} portrait` : `${name} portrait placeholder`}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={`${name} portrait`}
          style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(1) contrast(1.05)" }}
        />
      ) : (
        initialsOf(name)
      )}
    </div>
  );
}

export function PortraitPair({
  names,
  photos,
  size = 32,
}: {
  names: string[];
  photos?: (string | null | undefined)[];
  size?: number;
}) {
  const offset = Math.round(size * 0.55);
  const extra = names.length > 2 ? offset : 0;
  return (
    <div style={{ position: "relative", width: size + offset + extra, height: size + offset + extra, flexShrink: 0 }}>
      {names.slice(0, 3).map((name, i) => (
        <Portrait
          key={name + i}
          name={name}
          photoUrl={photos?.[i] ?? null}
          size={size}
          style={i > 0 ? { position: "absolute", left: offset * i, top: offset * i } : undefined}
        />
      ))}
    </div>
  );
}
