export function matchesUrlPattern(pattern: string, url: string) {
  const regex = new RegExp(`^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}\$`);
  return regex.test(url);
}
