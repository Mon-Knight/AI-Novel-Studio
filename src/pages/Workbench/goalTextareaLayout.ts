export function goalTextareaHeight(
  contentHeight: number,
  lineHeight: number,
  padding: number,
  viewportHeight: number,
): number {
  const minimum = lineHeight * 2 + padding;
  const maximum = Math.max(minimum, Math.min(lineHeight * 8 + padding, viewportHeight * 0.3));
  return Math.max(minimum, Math.min(contentHeight, maximum));
}
