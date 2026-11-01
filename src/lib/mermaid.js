// Mermaid is heavy; load it only when a reply actually contains a diagram.
export async function mermaidToSkeleton(definition) {
  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  const { elements, files } = await parseMermaidToExcalidraw(definition, { themeVariables: { fontSize: "18px" } });
  return { elements, files: files || {} };
}
