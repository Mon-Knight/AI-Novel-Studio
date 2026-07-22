export async function resolveCurrentQualityRequest<T>(
  operation: () => Promise<T>,
  isCurrent: () => boolean,
): Promise<T | undefined> {
  const result = await operation();
  return isCurrent() ? result : undefined;
}
