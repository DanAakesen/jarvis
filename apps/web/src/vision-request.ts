export function isCameraRequest(text: string): boolean {
  return /\b(?:what am i holding|what(?:'s| is) in my hand|look at (?:my|the) camera|what (?:can|do) you see|tell me what you see|(?:can|do) you see (?:anything|something|me|this|what i(?:'m| am) holding)|hvad holder jeg|hvad er det jeg holder|kig på (?:mit )?kamera(?:et)?|hvad (?:kan du se|ser du)|kan du se (?:noget|mig|det her|hvad jeg holder))\b/iu.test(text);
}

export function isScreenRequest(text: string): boolean {
  return /\b(?:look at (?:my|the) screen|what(?:'s| is) on (?:my|the) screen|(?:what (?:can|do) you see|tell me what you see|(?:can|do) you see (?:anything|something)) on (?:my|the) screen|kig på (?:min )?skærm(?:en)?|hvad (?:er der|kan du se|ser du) på (?:min )?skærm(?:en)?|kan du se noget på (?:min )?skærm(?:en)?)\b/iu.test(text);
}
