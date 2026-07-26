"use client";

import { PostPairingScreen } from "../../PlayerApp";

// Dev-only preview of the post-pairing rules screen — not linked from
// anywhere in the real player flow.
export default function PostPairingPreviewPage() {
  return (
    <main style={{ maxWidth: 428, margin: "0 auto", minHeight: "100dvh", padding: "16px 20px 40px", display: "flex", flexDirection: "column" }}>
      <p className="label" style={{ marginBottom: 12 }}>
        Post-pairing preview — dev only
      </p>
      <PostPairingScreen onContinue={() => {}} />
    </main>
  );
}
