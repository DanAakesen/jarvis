/** A source Jarvis does not serve. Distinct from loading, empty and error, which only apply to served sources. */
export function HealthUnavailable({ children }: { children: string }) {
  return <p className="health-unavailable" role="status"><strong>Unavailable.</strong> {children}</p>;
}
