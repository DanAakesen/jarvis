export function getSignInGreeting(date = new Date()): string {
  const hour = date.getHours();
  const greeting = hour >= 5 && hour < 12 ? 'Good morning' :
    hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${greeting}, Dan.`;
}
