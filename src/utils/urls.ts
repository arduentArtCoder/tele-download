const URL_PATTERN = /https?:\/\/\S+/gi;
const TRAILING_PUNCTUATION = new Set([",", ".", "!", "?", ":", ";", ")", "]", "}", ">"]);

function trimTrailingPunctuation(candidate: string): string {
  let result = candidate.trim();

  while (result.length > 0) {
    const lastCharacter = result[result.length - 1];

    if (!lastCharacter) {
      break;
    }

    if (!TRAILING_PUNCTUATION.has(lastCharacter)) {
      break;
    }

    result = result.slice(0, -1);
  }

  return result;
}

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN) ?? [];
  const uniqueUrls = new Set<string>();

  for (const match of matches) {
    const candidate = trimTrailingPunctuation(match);

    try {
      const parsed = new URL(candidate);
      uniqueUrls.add(parsed.toString());
    } catch {
      continue;
    }
  }

  return [...uniqueUrls];
}

export function getSourceHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return "unknown-source";
  }
}
