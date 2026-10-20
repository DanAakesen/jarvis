/** A source Jarvis does not serve. Distinct from loading, empty and error, which only apply to served sources. */
export function DailyUnavailable({ children }: { children: string }) {
  return <p className="daily-unavailable" role="status"><strong>Unavailable.</strong> {children}</p>;
}
