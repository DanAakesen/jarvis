export function isSimpleApproval(value: string): boolean {
  return /^(?:yes|approved|confirmed|go ahead)[.!]?$/iu.test(value.trim());
}
